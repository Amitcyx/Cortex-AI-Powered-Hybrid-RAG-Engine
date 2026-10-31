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
 * useVoiceSession - Manages active WebSocket connection, microphone capture,
 * audio playback, and state transitions for Cortex Compact Voice Mode.
 *
 * Implements PRD Section 14 lifecycle:
 * inactive -> listening -> processing/thinking -> speaking -> listening
 *
 * Ensures full cleanup on unmount or chat switch (stops mic tracks, closes WS, releases AudioContext).
 */
export function useVoiceSession({
  userId,
  sessionId,
  persona = "default",
  autoStart = true,
  onAddMessage,
}) {
  const [phase, setPhase] = useState("listening"); // "idle" | "listening" | "thinking" | "speaking" | "error"
  const [isMuted, setIsMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [voiceHistory, setVoiceHistory] = useState([]);
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
  const isListeningActiveRef = useRef(false);

  const onAddMessageRef = useRef(onAddMessage);
  const userIdRef = useRef(userId);
  const sessionIdRef = useRef(sessionId);

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

  // Audio level analyser with 30fps throttling for low CPU load on integrated graphics
  const setupAudioAnalyser = (stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = (timestamp) => {
        if (!analyserRef.current) return;

        // Throttle to ~30 fps (every 33ms)
        if (timestamp - lastAnalyserTimeRef.current >= 33) {
          lastAnalyserTimeRef.current = timestamp;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        }

        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      animFrameRef.current = requestAnimationFrame(updateLevel);
    } catch {}
  };

  const stopAudioAnalyser = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  // Forward declarations for mutual recursion
  const startListeningRef = useRef(null);

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

  // Play assistant audio queue
  const playNextInQueue = useCallback(() => {
    if (isPlayingRef.current) return;
    const nextB64 = audioQueueRef.current.shift();

    if (!nextB64) {
      // Audio queue finished! Return to listening state naturally (PRD lifecycle: speaking -> listening)
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

  // Stop microphone recording
  const stopListening = useCallback(() => {
    isListeningActiveRef.current = false;
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
    if (isPlayingRef.current) {
      stopPlayback();
    }

    // Stop existing recorder if any
    stopListening();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
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
      const mimeType = candidates.find((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) || "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      isListeningActiveRef.current = true;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopAudioAnalyser();
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/wav" });
        chunksRef.current = [];

        if (blob.size === 0) {
          if (isListeningActiveRef.current) {
            setPhase("idle");
          }
          return;
        }

        setPhase("thinking");
        try {
          const b64 = await blobToBase64(blob);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "audio", b64, mime: blob.type }));
            wsRef.current.send(JSON.stringify({ type: "stop" }));
          } else {
            setErrorMessage("Voice connection lost. Reconnecting...");
            setPhase("idle");
          }
        } catch {
          setPhase("idle");
          setErrorMessage("Failed to process microphone audio.");
        }
      };

      recorder.start(250);
      setPhase("listening");
      setUserTranscript("");
      setAssistantText("");
    } catch (err) {
      setErrorMessage(
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Microphone access denied. Please grant microphone permission in your browser settings."
          : `Microphone unavailable: ${err.message}`
      );
      setPhase("error");
    }
  }, [stopListening, stopPlayback]);

  startListeningRef.current = startListening;

  // Interrupt assistant mid-speech (barge-in)
  const interrupt = useCallback(() => {
    stopPlayback();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
    // Resume listening immediately after interrupt
    startListening();
  }, [stopPlayback, startListening]);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next) {
        // Muting stops listening and mutes playback
        stopListening();
        setPhase("muted");
      } else {
        // Unmuting resumes listening
        startListening();
      }
      return next;
    });
  }, [stopListening, startListening]);

  // WebSocket Connection Lifecycle
  const connectWebSocket = useCallback(() => {
    try {
      const wsUrl = getVoiceWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "start",
          user_id: userIdRef.current || "user_default",
          session_id: sessionIdRef.current || "default",
          persona: personaRef.current || "default",
        }));

        if (autoStart) {
          startListening();
        }
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          switch (msg.type) {
            case "ready":
              if (!isPlayingRef.current && phase !== "speaking") {
                setPhase((prev) => (prev === "error" ? prev : "listening"));
              }
              break;
            case "user_transcript":
              if (msg.text) {
                setUserTranscript(msg.text);
                setVoiceHistory((prev) => [...prev, { role: "user", content: msg.text }]);
                // Commit to active conversation turns (PRD FR-08)
                onAddMessageRef.current?.({ role: "user", content: msg.text, voiceMsg: true });
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
                setVoiceHistory((prev) => [...prev, { role: "assistant", content: msg.full }]);
                // Commit to active conversation turns (PRD FR-08)
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
        setErrorMessage("Voice connection error. Reconnecting...");
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

  // Initialize on mount, clean up fully on unmount
  useEffect(() => {
    connectWebSocket();

    return () => {
      // 1. Stop audio playback
      stopPlayback();
      // 2. Stop microphone tracks and recorder
      stopListening();
      // 3. Close audio analyser
      stopAudioAnalyser();
      // 4. Send end and terminate WebSocket
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
    voiceHistory,
    errorMessage,
    startListening,
    stopListening,
    interrupt,
    toggleMute,
  };
}
