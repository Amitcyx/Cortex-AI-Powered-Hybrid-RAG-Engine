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
 * useVoiceSession - Robust, persistent voice companion session hook.
 *
 * Key features:
 * - Persistent WebSocket connection bound to sessionId (no teardown on re-renders).
 * - Automatic reconnection if network or socket drops.
 * - Persistent microphone stream: avoids re-requesting mic permissions on each turn.
 * - Natural Voice Activity Detection (VAD): auto-submits upon 1.3s of pause after speaking.
 * - Immediate Tap-to-Send on the orb.
 * - Full turn lifecycle: listening -> thinking -> speaking -> listening.
 * - Zero resource leaks on unmount.
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

  // Connection & audio refs
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
  const isMountedRef = useRef(true);

  // VAD & Turn State refs
  const isMutedRef = useRef(false);
  const personaRef = useRef(persona);
  const phaseRef = useRef(phase);
  const userHasSpokenRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const pendingAudioPayloadRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

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

  // Update persona over active WebSocket
  useEffect(() => {
    personaRef.current = persona;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "persona", persona }));
    }
  }, [persona]);

  // Teardown analyser & VAD timers
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

  // Stop assistant audio playback cleanly
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

  // Forward refs for recursive turn functions
  const startListeningRef = useRef(null);
  const submitSpeechRef = useRef(null);

  // Play queued assistant audio chunks sequentially
  const playNextInQueue = useCallback(() => {
    if (isPlayingRef.current) return;
    const nextB64 = audioQueueRef.current.shift();

    if (!nextB64) {
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

  // Submit speech audio to backend
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

  // Setup live audio analyser & VAD
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
        if (!analyserRef.current || !isMountedRef.current) return;

        // Throttle to ~30 fps
        if (timestamp - lastAnalyserTimeRef.current >= 33) {
          lastAnalyserTimeRef.current = timestamp;
          analyserRef.current.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          const currentEnergy = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(currentEnergy);

          // Voice Activity Detection (VAD)
          if (phaseRef.current === "listening" && !isMutedRef.current && !isSubmittingRef.current) {
            if (currentEnergy >= 16) {
              userHasSpokenRef.current = true;
              if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
              }
            } else if (userHasSpokenRef.current && currentEnergy < 12) {
              // Pause detected after speech: auto-submit after 1.3s
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

  // Helper: ensures WebSocket is OPEN before sending audio
  const sendVoicePayload = (payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    // Socket not ready; queue payload
    pendingAudioPayloadRef.current = payload;
    return false;
  };

  // Start microphone recording turn
  const startListening = useCallback(async () => {
    if (!isMountedRef.current) return;

    setErrorMessage("");
    userHasSpokenRef.current = false;
    isSubmittingRef.current = false;

    if (isPlayingRef.current) {
      stopPlayback();
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }

    try {
      let stream = streamRef.current;
      // Re-use active stream tracks to avoid repeated browser prompts
      if (!stream || !stream.active || stream.getAudioTracks().length === 0) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
        setupAudioAnalyser(stream);
      } else if (!analyserRef.current) {
        setupAudioAnalyser(stream);
      }

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
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        chunksRef.current = [];
        recorderRef.current = null;

        if (blob.size === 0 || !userHasSpokenRef.current) {
          isSubmittingRef.current = false;
          if (isMountedRef.current && phaseRef.current !== "muted") {
            setPhase("listening");
            startListeningRef.current?.();
          }
          return;
        }

        setPhase("thinking");
        try {
          const b64 = await blobToBase64(blob);
          const audioMsg = { type: "audio", b64, mime: blob.type };
          const stopMsg = { type: "stop" };

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(audioMsg));
            wsRef.current.send(JSON.stringify(stopMsg));
          } else {
            // Socket momentarily buffering/reconnecting
            sendVoicePayload(audioMsg);
            sendVoicePayload(stopMsg);
          }
        } catch {
          setPhase("error");
          setErrorMessage("Failed to process microphone audio.");
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
          ? "Microphone access denied. Please click the lock/camera icon in your address bar to allow microphone."
          : `Microphone unavailable: ${err.message}`
      );
      setPhase("error");
    }
  }, [stopPlayback]);

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
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          try { recorderRef.current.stop(); } catch {}
        }
        stopAudioAnalyser();
        setPhase("muted");
      } else {
        startListening();
      }
      return next;
    });
  }, [startListening]);

  // Stop listening completely (used on close/unmount)
  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    userHasSpokenRef.current = false;
    isSubmittingRef.current = false;

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    recorderRef.current = null;
    stopAudioAnalyser();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Persistent WebSocket connection manager
  useEffect(() => {
    isMountedRef.current = true;
    let ws = null;

    const connect = () => {
      if (!isMountedRef.current) return;

      try {
        const wsUrl = getVoiceWebSocketUrl();
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMountedRef.current) return;
          setErrorMessage("");

          // Send handshake
          ws.send(
            JSON.stringify({
              type: "start",
              user_id: userIdRef.current || "user_default",
              session_id: sessionIdRef.current || "default",
              persona: personaRef.current || "default",
            })
          );

          // Flush any pending payload
          if (pendingAudioPayloadRef.current) {
            ws.send(JSON.stringify(pendingAudioPayloadRef.current));
            pendingAudioPayloadRef.current = null;
          }

          if (autoStart) {
            startListeningRef.current?.();
          }
        };

        ws.onmessage = (e) => {
          if (!isMountedRef.current) return;
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
                  // Empty transcript (background noise): return to listening
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
                startListeningRef.current?.();
                break;

              case "error":
                setErrorMessage(msg.message || "Voice mode error.");
                setPhase("error");
                break;
            }
          } catch {}
        };

        ws.onerror = () => {
          if (!isMountedRef.current) return;
          setErrorMessage("Voice connection error. Reconnecting...");
        };

        ws.onclose = () => {
          if (!isMountedRef.current) return;
          // Auto-reconnect with 1.5s delay if still mounted
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              connect();
            }
          }, 1500);
        };
      } catch (err) {
        if (isMountedRef.current) {
          setErrorMessage(err.message || "WebSocket failed");
          setPhase("error");
        }
      }
    };

    connect();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      stopPlayback();
      stopListening();
      stopAudioAnalyser();

      if (ws) {
        try { ws.send(JSON.stringify({ type: "end" })); } catch {}
        try { ws.close(); } catch {}
      }
      wsRef.current = null;
    };
  }, [sessionId, autoStart, enqueueAudio, stopListening, stopPlayback]);

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
