import { useState, useRef, useCallback, useEffect } from "react";
import { getVoiceWebSocketUrl, fetchIntroAudioBlob } from "../api/voice";

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

export function useVoiceSession({ userId, sessionId, persona = "default", onAddMessage }) {
  const [phase, setPhase] = useState("idle"); // "idle" | "listening" | "thinking" | "speaking"
  const [isMuted, setIsMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [voiceHistory, setVoiceHistory] = useState([]); // [{ role, content }]
  const [errorMessage, setErrorMessage] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioQueueRef = useRef([]);
  const currentAudioRef = useRef(null);
  const isPlayingRef = useRef(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const isMutedRef = useRef(false);
  const personaRef = useRef(persona);

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

  // Audio level analyser for waveform
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
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch {}
  };

  const stopAudioAnalyser = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  // Play assistant audio queue
  const playNextInQueue = useCallback(() => {
    if (isPlayingRef.current) return;
    const nextB64 = audioQueueRef.current.shift();
    if (!nextB64) {
      setPhase((prev) => (prev === "speaking" ? "idle" : prev));
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

  // WebSocket lifecycle (connect once when mounted or when sessionId changes)
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
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          switch (msg.type) {
            case "ready":
              setPhase((prev) => (prev === "speaking" ? prev : "idle"));
              break;
            case "user_transcript":
              if (msg.text) {
                setUserTranscript(msg.text);
                setVoiceHistory((prev) => [...prev, { role: "user", content: msg.text }]);
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
                onAddMessageRef.current?.({ role: "assistant", content: msg.full, voiceMsg: true });
              }
              break;
            case "interrupted":
              stopPlayback();
              setPhase("idle");
              break;
            case "error":
              setErrorMessage(msg.message || "Voice mode error");
              setPhase("idle");
              break;
          }
        } catch {}
      };

      ws.onerror = () => {
        setErrorMessage("Voice connection error. Reconnecting or using audio fallback.");
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch (err) {
      setErrorMessage(err.message || "WebSocket connection failed");
    }
  }, [enqueueAudio, stopPlayback]);

  // Initial connection & Intro voice (once on mount)
  useEffect(() => {
    connectWebSocket();

    let mounted = true;
    fetchIntroAudioBlob(personaRef.current)
      .then((blob) => {
        if (!mounted || isMutedRef.current) return;
        const url = URL.createObjectURL(blob);
        const introAudio = new Audio(url);
        currentAudioRef.current = introAudio;
        isPlayingRef.current = true;
        setPhase("speaking");

        introAudio.onended = () => {
          URL.revokeObjectURL(url);
          isPlayingRef.current = false;
          currentAudioRef.current = null;
          if (mounted) setPhase("idle");
        };
        introAudio.onerror = () => {
          URL.revokeObjectURL(url);
          isPlayingRef.current = false;
          currentAudioRef.current = null;
          if (mounted) setPhase("idle");
        };
        introAudio.play().catch(() => {
          isPlayingRef.current = false;
          currentAudioRef.current = null;
          if (mounted) setPhase("idle");
        });
      })
      .catch(() => {
        if (mounted) setPhase("idle");
      });

    return () => {
      mounted = false;
      stopPlayback();
      stopAudioAnalyser();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
      if (wsRef.current) {
        try { wsRef.current.send(JSON.stringify({ type: "end" })); } catch {}
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [connectWebSocket, stopPlayback]);

  // Start recording speech
  const startListening = useCallback(async () => {
    setErrorMessage("");
    if (phase === "speaking") {
      // Barge-in interrupt
      interrupt();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopAudioAnalyser();
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/wav" });
        chunksRef.current = [];

        if (blob.size === 0) {
          setPhase("idle");
          return;
        }

        setPhase("thinking");
        try {
          const b64 = await blobToBase64(blob);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "audio", b64, mime: blob.type }));
            wsRef.current.send(JSON.stringify({ type: "stop" }));
          } else {
            // Socket not connected, attempt reconnection
            setErrorMessage("Voice socket disconnected. Reconnecting...");
            connectWebSocket();
            setPhase("idle");
          }
        } catch {
          setPhase("idle");
          setErrorMessage("Failed to process speech audio.");
        }
      };

      recorder.start(250);
      setPhase("listening");
      setUserTranscript("");
      setAssistantText("");
    } catch (err) {
      setErrorMessage(`Microphone access denied: ${err.message}`);
      setPhase("idle");
    }
  }, [phase]);

  // Stop recording speech
  const stopListening = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }, []);

  // Barge-in / Interrupt AI
  const interrupt = useCallback(() => {
    stopPlayback();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
    setPhase("idle");
  }, [stopPlayback]);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (currentAudioRef.current) {
        currentAudioRef.current.muted = next;
      }
      return next;
    });
  }, []);

  return {
    phase,
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
