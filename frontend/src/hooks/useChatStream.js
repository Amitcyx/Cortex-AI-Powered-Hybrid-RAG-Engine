import { useState, useRef, useCallback } from "react";
import { streamChat } from "../api/chat";

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef(null);

  const startStream = useCallback(async ({ userId, sessionId, message, onToken, onDone, onError }) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);

    try {
      await streamChat({
        userId,
        sessionId,
        message,
        signal: controller.signal,
        onToken: (token) => {
          onToken?.(token);
        },
        onDone: (fullText) => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          onDone?.(fullText);
        },
        onError: (err) => {
          setIsStreaming(false);
          abortControllerRef.current = null;
          onError?.(err);
        },
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        setIsStreaming(false);
        abortControllerRef.current = null;
        onError?.(err.message || "Failed to stream response");
      }
    }
  }, []);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  return {
    isStreaming,
    startStream,
    stopStream,
  };
}
