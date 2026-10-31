const BASE_URL = "/api";

export class ApiError extends Error {
  constructor(message, status = 500, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Standard fetch wrapper with JSON parsing and standardized error handling.
 */
export async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint}`;
  const headers = { ...options.headers };

  // Don't set Content-Type for FormData
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    throw new ApiError(`Network connection failed: ${err.message}`, 0);
  }

  if (!response.ok) {
    let errorMsg = response.statusText;
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        errorMsg = json.detail || json.message || errorMsg;
      } catch {
        errorMsg = text || errorMsg;
      }
    } catch {}
    throw new ApiError(errorMsg, response.status);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response;
}

/**
 * SSE Streaming helper for /chat/stream.
 * Parses SSE lines: `event: <name>\ndata: <json>\n\n`
 */
export async function streamSSE(endpoint, body, { onToken, onDone, onError, signal }) {
  const url = `${BASE_URL}${endpoint}`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      return;
    }
    onError?.(err.message || "Connection failed");
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    onError?.(errorText || "Streaming request failed");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let doneHandled = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // Normalize CRLF to LF
      buffer = buffer.replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        if (!block.trim()) continue;
        let eventType = "message";
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
        if (eventType === "token") {
          onToken?.(dataStr);
        } else if (eventType === "done") {
          if (!doneHandled) {
            doneHandled = true;
            onDone?.(dataStr);
          }
        } else if (eventType === "error") {
          onError?.(dataStr || "Streaming error");
        } else if (dataStr) {
          // Default fallback
          onToken?.(dataStr);
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      onError?.(err.message || "Stream interrupted");
    }
  } finally {
    reader.releaseLock();
  }
}
