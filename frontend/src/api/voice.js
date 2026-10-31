import { apiFetch } from "./client";

export async function fetchVoicePersonas() {
  try {
    const res = await apiFetch("/speech/personas");
    return res?.personas || [];
  } catch {
    return [
      { name: "default", label: "Default", voice: "autumn", description: "Balanced and helpful" },
      { name: "calm", label: "Calm", voice: "diana", description: "Gentle and patient" },
      { name: "energetic", label: "Energetic", voice: "hannah", description: "Upbeat and dynamic" },
      { name: "professional", label: "Professional", voice: "austin", description: "Concise and formal" },
      { name: "friendly", label: "Friendly", voice: "daniel", description: "Warm and conversational" },
    ];
  }
}

export async function fetchIntroAudioBlob(voice = "autumn") {
  const url = `/api/speech/intro?voice=${encodeURIComponent(voice)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch intro audio");
  return res.blob();
}

/**
 * Returns the primary WebSocket endpoint for compact voice streaming.
 * Uses same-origin URL so it works seamlessly behind Vite dev proxy or production reverse proxy.
 */
export function getVoiceWebSocketUrl() {
  const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  if (typeof window !== "undefined" && window.location.host) {
    return `${protocol}//${window.location.host}/voice/stream`;
  }
  return "ws://127.0.0.1:8000/voice/stream";
}

/**
 * Returns prioritized WebSocket candidates to guarantee connectivity across Windows IPv4/IPv6 stacks:
 * 1. Same-origin proxied WebSocket (/voice/stream)
 * 2. Explicit IPv4 loopback (127.0.0.1:8000/voice/stream)
 */
export function getVoiceWebSocketCandidates() {
  const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  const candidates = [];
  if (typeof window !== "undefined" && window.location.host) {
    candidates.push(`${protocol}//${window.location.host}/voice/stream`);
  }
  candidates.push(`${protocol}//127.0.0.1:8000/voice/stream`);
  return candidates;
}
