import { apiFetch } from "./client";

export async function uploadDocument({ userId, file }) {
  const fd = new FormData();
  fd.append("user_id", userId);
  fd.append("file", file);

  return apiFetch("/upload", {
    method: "POST",
    body: fd,
  });
}

/**
 * Streams document indexing progress (with percentage counter) via SSE.
 * Calls onProgress({ stage, progress, message, ... })
 * Calls onDone(payload)
 * Calls onError(errorString)
 */
export async function uploadDocumentStream({
  userId,
  file,
  onProgress,
  onDone,
  onError,
  signal,
}) {
  const fd = new FormData();
  fd.append("user_id", userId || "user_default");
  fd.append("file", file);

  let response;
  try {
    response = await fetch("/api/upload/stream", {
      method: "POST",
      body: fd,
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") return;
    onError?.(err.message || "Network request failed");
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    onError?.(errorText || "Upload request failed");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        if (!block.trim()) continue;
        let eventType = "progress";
        const dataLines = [];

        for (const rawLine of block.split("\n")) {
          const line = rawLine.replace(/\r$/, "");
          if (line.startsWith("event:")) {
            eventType = line.replace(/^event:\s*/, "").trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.replace(/^data:\s?/, ""));
          }
        }

        const dataStr = dataLines.join("\n");
        let payload = {};
        try {
          payload = JSON.parse(dataStr);
        } catch {
          payload = { message: dataStr };
        }

        if (eventType === "progress") {
          onProgress?.(payload);
        } else if (eventType === "done") {
          onDone?.(payload);
        } else if (eventType === "error") {
          onError?.(payload.message || "Indexing failed");
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    onError?.(err.message || "Stream interrupted");
  }
}

export async function fetchUserFiles(userId) {
  const res = await apiFetch(`/files?user_id=${encodeURIComponent(userId)}`);
  return res?.files || [];
}
