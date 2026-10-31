import { useState, useRef, useCallback, useEffect } from "react";
import { getVoiceWebSocketUrl } from "../api/voice";

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result || "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * useVoiceSession - Complete, natural Voice Assistant session controller.
 * Implements ChatGPT-style natural conversation:
 * - Natural Voice Activity Detection (VAD): auto-submits when user pauses speaking (~1.2s of silence).
 * - Immediate Tap-to-Submit: user can tap the orb anytime to submit immediately.
 * - Auto-turn lifecycle: Listening -> Processing/Thinking -> Speaking -> Listening.
 * - Natural Barge-in: tapping or speaking interrupts the assistant mid-sentence.
 * - Comprehensive resource cleanup on chat-switch or unmount.
 */
export function useVoiceSession({
  userId,
  sessionId,
  persona = "default",
  autoStart = true,
  onAddMessage,
}) {
  const [phase, setPhase] = useState("listening"); // "listening" | "thinking" | "speaking" | "muted" | "error" | "idle"
  const [isMuted, setIsMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioQueueRef = useRef([]);
  const currentAudioRef = useRef(null);
  const isPlayingRef = useRef(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastAnalyserTimeRef = useRef(0);
  const isMutedRef = useRef(false);
  const personaRef = useRef(persona);
  const phaseRef = useRef(phase);

  // VAD (Voice Activity Detection) tracking
  const userHasSpokenRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const isSubmittingRef = useRef(false);

  const onAddMessageRef = useRef(onAddMessage);
  const userIdRef = useRef(userId);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    onAddMessageRef.current = onAddMessage;
  }, [onAddMessage]);

  useEffect(() => {
    userIdRef.current = userId;
    sessionIdRef.current = sessionId;
  }, [userId, sessionId]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    personaRef.current = persona;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "persona", persona }));
    }
  }, [persona]);

  // Clean audio analyser teardown
  const stopAudioAnalyser = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  // Stop playback cleanly
  const stopPlayback = useCallback(() => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      } catch {}
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // Forward refs for circular callback dependencies
  const startListeningRef = useRef(null);
  const submitSpeechRef = useRef(null);

  // Play assistant audio chunks sequentially
  const playNextInQueue = useCallback(() => {
    if (isPlayingRef.current) return;
    const nextB64 = audioQueueRef.current.shift();

    if (!nextB64) {
      // Finished speaking all sentences! Seamlessly return to listening (ChatGPT style)
      isPlayingRef.current = false;
      if (!isMutedRef.current && startListeningRef.current) {
        startListeningRef.current();
      } else {
        setPhase("idle");
      }
      return;
    }

    isPlayingRef.current = true;
    setPhase("speaking");

    const audio = new Audio(`data:audio/wav;base64,${nextB64}`);
    currentAudioRef.current = audio;
    audio.muted = isMutedRef.current;

    audio.onended = () => {
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      playNextInQueue();
    };

    audio.onerror = () => {
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      playNextInQueue();
    };

    audio.play().catch(() => {
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      playNextInQueue();
    });
  }, []);

  const enqueueAudio = useCallback((b64) => {
    audioQueueRef.current.push(b64);
    playNextInQueue();
  }, [playNextInQueue]);

  // Submit recorded speech buffer to backend
  const submitSpeech = useCallback(() => {
    if (isSubmittingRef.current) return;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    isSubmittingRef.current = true;
    setPhase("thinking");

    try {
      if (typeof recorder.requestData === "function") {
        recorder.requestData();
      }
      recorder.stop();
    } catch {
      isSubmittingRef.current = false;
      setPhase("listening");
    }
  }, []);

  submitSpeechRef.current = submitSpeech;

  // Setup live audio analyser & Voice Activity Detection (VAD)
  const setupAudioAnalyser = (stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = (timestamp) => {
        if (!analyserRef.current) return;

        // Throttle analyser to ~30 fps (every 33ms) for optimal low-end performance
        if (timestamp - lastAnalyserTimeRef.current >= 33) {
          lastAnalyserTimeRef.current = timestamp;
          analyserRef.current.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          const currentEnergy = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(currentEnergy);

          // Voice Activity Detection (VAD) logic while listening
          if (phaseRef.current === "listening" && !isMutedRef.current && !isSubmittingRef.current) {
            if (currentEnergy >= 16) {
              // User is actively speaking
              userHasSpokenRef.current = true;
              if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
              }
            } else if (userHasSpokenRef.current && currentEnergy < 12) {
              // User has finished speaking and paused for 1.3 seconds -> auto-submit
              if (!silenceTimerRef.current) {
                silenceTimerRef.current = setTimeout(() => {
                  if (phaseRef.current === "listening" && !isSubmittingRef.current) {
                    submitSpeechRef.current?.();
                  }
                }, 1300);
              }
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(updateLevel);
      };

      animFrameRef.current = requestAnimationFrame(updateLevel);
    } catch {}
  };

  // Stop microphone capture without submitting
  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    userHasSpokenRef.current = false;
    isSubmittingRef.current = false;

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    recorderRef.current = null;
    stopAudioAnalyser();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Start microphone recording
  const startListening = useCallback(async () => {
    setErrorMessage("");
    userHasSpokenRef.current = false;
    isSubmittingRef.current = false;

    if (isPlayingRef.current) {
      stopPlayback();
    }

    stopListening();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      setupAudioAnalyser(stream);

      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/wav",
      ];
      const mimeType =
        candidates.find(
          (c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)
        ) || "";

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stopAudioAnalyser();

        // Release mic stream tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        chunksRef.current = [];
        recorderRef.current = null;

        // If no speech was recorded (e.g. quick tap or cancellation), return to listening
        if (blob.size === 0 || !userHasSpokenRef.current) {
          isSubmittingRef.current = false;
          setPhase("listening");
          startListeningRef.current?.();
          return;
        }

        setPhase("thinking");
        try {
          const b64 = await blobToBase64(blob);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "audio", b64, mime: blob.type }));
            wsRef.current.send(JSON.stringify({ type: "stop" }));
          } else {
            setErrorMessage("Voice socket disconnected. Reconnecting...");
            setPhase("error");
          }
        } catch {
          setPhase("error");
          setErrorMessage("Failed to process speech audio.");
        } finally {
          isSubmittingRef.current = false;
        }
      };

      recorder.start(200);
      setPhase("listening");
      setUserTranscript("");
      setAssistantText("");
    } catch (err) {
      setErrorMessage(
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Microphone access denied. Please click the camera/mic icon in your browser address bar to allow microphone access."
          : `Microphone unavailable: ${err.message}`
      );
      setPhase("error");
    }
  }, [stopListening, stopPlayback]);

  startListeningRef.current = startListening;

  // Interrupt assistant speech (barge-in)
  const interrupt = useCallback(() => {
    stopPlayback();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
    startListening();
  }, [stopPlayback, startListening]);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next) {
        stopListening();
        setPhase("muted");
      } else {
        startListening();
      }
      return next;
    });
  }, [stopListening, startListening]);

  // WebSocket connection & lifecycle
  const connectWebSocket = useCallback(() => {
    try {
      const wsUrl = getVoiceWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "start",
            user_id: userIdRef.current || "user_default",
            session_id: sessionIdRef.current || "default",
            persona: personaRef.current || "default",
          })
        );

        if (autoStart) {
          startListening();
        }
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          switch (msg.type) {
            case "ready":
              if (!isPlayingRef.current && phaseRef.current !== "speaking") {
                setPhase((prev) => (prev === "error" ? prev : "listening"));
              }
              break;

            case "user_transcript":
              if (msg.text) {
                setUserTranscript(msg.text);
                onAddMessageRef.current?.({ role: "user", content: msg.text, voiceMsg: true });
              } else {
                // If silence or empty audio was sent, automatically return to listening
                setPhase("listening");
                startListeningRef.current?.();
              }
              break;

            case "assistant_delta":
              if (msg.text) {
                setAssistantText((prev) => (prev ? prev + " " + msg.text : msg.text));
              }
              break;

            case "assistant_audio":
              if (msg.b64 && !isMutedRef.current) {
                enqueueAudio(msg.b64);
              }
              break;

            case "turn_done":
              if (msg.full) {
                setAssistantText(msg.full);
                onAddMessageRef.current?.({ role: "assistant", content: msg.full, voiceMsg: true });
              }
              break;

            case "interrupted":
              stopPlayback();
              startListening();
              break;

            case "error":
              setErrorMessage(msg.message || "Voice mode encountered an error.");
              setPhase("error");
              break;
          }
        } catch {}
      };

      ws.onerror = () => {
        setErrorMessage("Voice connection error. Tap orb to reconnect.");
        setPhase("error");
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch (err) {
      setErrorMessage(err.message || "WebSocket connection failed");
      setPhase("error");
    }
  }, [autoStart, enqueueAudio, startListening, stopPlayback]);

  // Mount & unmount lifecycle
  useEffect(() => {
    connectWebSocket();

    return () => {
      stopPlayback();
      stopListening();
      stopAudioAnalyser();
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ type: "end" }));
        } catch {}
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [connectWebSocket, stopListening, stopPlayback]);

  return {
    phase: isMuted ? "muted" : phase,
    audioLevel,
    isMuted,
    userTranscript,
    assistantText,
    errorMessage,
    startListening,
    stopListening,
    submitSpeech,
    interrupt,
    toggleMute,
  };
}
