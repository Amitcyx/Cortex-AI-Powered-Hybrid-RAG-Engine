import { apiFetch, streamSSE } from "./client";

export async function streamChat({ userId, sessionId, message, onToken, onDone, onError, signal }) {
  return streamSSE(
    "/chat/stream",
    { user_id: userId, session_id: sessionId, message },
    { onToken, onDone, onError, signal }
  );
}

export async function sendNonStreamChat({ userId, sessionId, message }) {
  return apiFetch("/chat", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, session_id: sessionId, message }),
  });
}

export async function sendImageChat({ userId, sessionId, message, imageFile }) {
  const fd = new FormData();
  fd.append("user_id", userId);
  fd.append("session_id", sessionId);
  fd.append("message", message || "Describe this image.");
  fd.append("image", imageFile);

  return apiFetch("/chat/image", {
    method: "POST",
    body: fd,
  });
}

export async function sendVideoChat({ userId, sessionId, message, videoFile }) {
  const fd = new FormData();
  fd.append("user_id", userId);
  fd.append("session_id", sessionId);
  fd.append("message", message || "What is happening in this video?");
  fd.append("video", videoFile);

  return apiFetch("/chat/video", {
    method: "POST",
    body: fd,
  });
}

export async function sendAudioChat({ userId, sessionId, message, audioFile, filename }) {
  const fd = new FormData();
  fd.append("user_id", userId);
  fd.append("session_id", sessionId);
  fd.append("message", message || "");
  fd.append("audio", audioFile, filename || "recording.webm");

  return apiFetch("/chat/audio", {
    method: "POST",
    body: fd,
  });
}

export async function transcribeAudio({ audioFile, filename }) {
  const fd = new FormData();
  fd.append("audio", audioFile, filename || "recording.webm");

  const res = await apiFetch("/speech/transcribe", {
    method: "POST",
    body: fd,
  });
  return res.transcript || "";
}

export async function consolidateMemory({ userId, sessionId }) {
  return apiFetch(`/memory/consolidate?user_id=${encodeURIComponent(userId)}&session_id=${encodeURIComponent(sessionId)}`, {
    method: "POST",
  });
}

export async function checkHealth() {
  try {
    const res = await apiFetch("/health");
    return Boolean(res?.model_reachable);
  } catch {
    return false;
  }
}
