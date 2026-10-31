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

export function getVoiceWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (typeof window !== "undefined" && window.location.port === "5173") {
    return `${protocol}//${window.location.hostname}:8000/voice/stream`;
  }
  return `${protocol}//${window.location.host}/voice/stream`;
}
