import { useState, useRef, useCallback, useEffect } from "react";
import { getVoiceWebSocketCandidates } from "../api/voice";

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
 * useVoiceSession - Robust, persistent compact voice companion session hook.
 *
 * Core capabilities:
 * - Resilient WebSocket connection lifecycle with candidate failover (same-origin proxy -> direct 127.0.0.1:8000).
 * - Automatic reconnection with exponential backoff on unexpected drops.
 * - Persistent microphone stream to prevent repeated browser permission prompts.
 * - Natural Voice Activity Detection (VAD) auto-submit on 1.3s speech pause.
 * - Immediate Tap-to-Send / Tap-to-Interrupt on the orb.
 * - Full turn lifecycle: listening -> thinking -> speaking -> listening.
 * - Zero resource leaks or callback races across unmounts or chat switches.
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

  const onAddMessageRef = useRef(onAddMessage);
  const userIdRef = useRef(userId);
  const sessionIdRef = useRef(sessionId);

  // Forward refs for stable turn handlers
  const startListeningRef = useRef(null);
  const stopListeningRef = useRef(null);
  const submitSpeechRef = useRef(null);
  const stopPlaybackRef = useRef(null);
  const enqueueAudioRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  // Update persona over active WebSocket when user changes settings
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
  stopPlaybackRef.current = stopPlayback;

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

  const enqueueAudio = useCallback(
    (b64) => {
      audioQueueRef.current.push(b64);
      playNextInQueue();
    },
    [playNextInQueue]
  );
  enqueueAudioRef.current = enqueueAudio;

  // Submit recorded user speech
  const submitSpeech = useCallback(() => {
    if (isSubmittingRef.current) return;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    userHasSpokenRef.current = true;
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

        // Throttle analyser updates to ~30 fps
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
      stopPlaybackRef.current?.();
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {}
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
          ? "Microphone access denied. Please click the lock icon in your address bar to allow microphone."
          : `Microphone unavailable: ${err.message}`
      );
      setPhase("error");
    }
  }, []);
  startListeningRef.current = startListening;

  // Interrupt assistant speech (barge-in)
  const interrupt = useCallback(() => {
    stopPlaybackRef.current?.();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
    startListeningRef.current?.();
  }, []);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next) {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          try {
            recorderRef.current.stop();
          } catch {}
        }
        stopAudioAnalyser();
        setPhase("muted");
      } else {
        startListeningRef.current?.();
      }
      return next;
    });
  }, []);

  // Stop listening completely (used on close/unmount)
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
  stopListeningRef.current = stopListening;

  // Persistent, failover-safe WebSocket connection manager
  useEffect(() => {
    let isCurrent = true;
    let ws = null;
    let reconnectTimer = null;
    let candidateIndex = 0;
    let retryCount = 0;
    let isIntentionalClose = false;

    const candidates = getVoiceWebSocketCandidates();

    const connect = () => {
      if (!isCurrent || isIntentionalClose) return;

      // Clean up any stale socket on this instance before opening next
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close(1000, "Switching candidates");
        } catch {}
        ws = null;
      }

      const wsUrl = candidates[candidateIndex % candidates.length];

      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isCurrent || isIntentionalClose) return;
          retryCount = 0;
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
          if (!isCurrent || isIntentionalClose) return;
          try {
            const msg = JSON.parse(e.data);
            switch (msg.type) {
              case "ready":
                setErrorMessage("");
                if (!isPlayingRef.current && phaseRef.current !== "speaking") {
                  setPhase("listening");
                }
                break;

              case "user_transcript":
                if (msg.text) {
                  setUserTranscript(msg.text);
                  onAddMessageRef.current?.({ role: "user", content: msg.text, voiceMsg: true });
                } else {
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
                  enqueueAudioRef.current?.(msg.b64);
                }
                break;

              case "turn_done":
                if (msg.full) {
                  setAssistantText(msg.full);
                  onAddMessageRef.current?.({ role: "assistant", content: msg.full, voiceMsg: true });
                }
                break;

              case "interrupted":
                stopPlaybackRef.current?.();
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
          if (!isCurrent || isIntentionalClose) return;
          // Advance candidate to next endpoint in case of host/proxy refusal
          candidateIndex++;
        };

        ws.onclose = (event) => {
          if (!isCurrent || isIntentionalClose || event.code === 1000) return;

          const delay = Math.min(1000 * Math.pow(1.5, retryCount), 5000);
          retryCount++;

          if (retryCount > 1) {
            setErrorMessage("Connecting to voice service...");
          }

          reconnectTimer = setTimeout(() => {
            if (isCurrent && !isIntentionalClose) {
              connect();
            }
          }, delay);
        };
      } catch (err) {
        if (isCurrent && !isIntentionalClose) {
          candidateIndex++;
          reconnectTimer = setTimeout(() => {
            if (isCurrent && !isIntentionalClose) {
              connect();
            }
          }, 1500);
        }
      }
    };

    connect();

    return () => {
      isCurrent = false;
      isIntentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);

      stopPlaybackRef.current?.();
      stopListeningRef.current?.();
      stopAudioAnalyser();

      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.send(JSON.stringify({ type: "end" }));
        } catch {}
        try {
          ws.close(1000, "Session ended");
        } catch {}
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [sessionId, autoStart]);

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
