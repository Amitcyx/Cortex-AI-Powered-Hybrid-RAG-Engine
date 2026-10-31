import os
import re
import base64
from groq import Groq
from openai import OpenAI
import time
 
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

_client = None
 
def get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY is not set. Copy .env.example to .env and fill it in.")
        _client = Groq(api_key=api_key)
    return _client
 
 
def strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
 
 
def image_to_data_url(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{b64}"

def estimate_tokens(text: str) -> int:
    return len(text) // 4


def trim_messages_to_budget(messages: list[dict], max_tokens: int = 6500) -> list[dict]:
    def msg_tokens(m):
        if not m:
            return 0
        content = m.get("content", "")
        if isinstance(content, list):
            text_parts = [c.get("text", "") for c in content if c.get("type") == "text"]
            return estimate_tokens(" ".join(text_parts)) + len(content) * 300
        return estimate_tokens(str(content))

    if not messages:
        return messages

    system_msg = messages[0] if messages[0]["role"] == "system" else None
    latest_user_msg = messages[-1]
    middle = messages[1:-1] if system_msg else messages[:-1]

    total = msg_tokens(system_msg or {}) + msg_tokens(latest_user_msg)
    kept_middle = []

    for m in reversed(middle):
        t = msg_tokens(m)
        if total + t > max_tokens:
            break
        kept_middle.insert(0, m)
        total += t

    result = ([system_msg] if system_msg else []) + kept_middle + [latest_user_msg]
    if len(result) < len(messages):
        print(f"[trim_messages_to_budget] Dropped {len(messages) - len(result)} message(s) to stay under token budget (~{total} tokens)")
    return result
 
 
def chat(messages: list[dict], images: list[bytes] | None = None, is_video_frames: bool = False,
         max_retries: int = 3, model: str | None = None) -> str:
    formatted = list(messages)

    if images:
        last = formatted[-1]
        text = last["content"]
        if is_video_frames:
            text = (
                f"The following {len(images)} images are sequential frames "
                f"sampled evenly across a video, in chronological order. "
                f"Use them together to answer about the video's content/action.\n\n{text}"
            )
        content_blocks = [{"type": "text", "text": text}]
        for img_bytes in images:
            content_blocks.append({
                "type": "image_url",
                "image_url": {"url": image_to_data_url(img_bytes)}
            })
        formatted[-1] = {"role": "user", "content": content_blocks}

    formatted = trim_messages_to_budget(formatted)

    use_model = model or GROQ_MODEL

    last_error = None
    for attempt in range(max_retries):
        try:
            completion = get_client().chat.completions.create(
                model=use_model,
                messages=formatted,
            )
            raw = completion.choices[0].message.content
            return strip_thinking(raw)
        except Exception as e:
            last_error = e
            status_code = getattr(e, "status_code", None)
            if status_code == 429:
                wait = (attempt + 1) * 15
                print(f"[chat] Rate limited (429), waiting {wait}s before retry {attempt+1}/{max_retries}...")
                time.sleep(wait)
                continue
            raise

    raise RuntimeError(f"Still rate limited after {max_retries} retries: {last_error}")


async def stream_chat(
    messages: list[dict],
    on_token,
    on_done=None,
    on_error=None,
    images: list[bytes] | None = None,
    is_video_frames: bool = False,
    model: str | None = None,
    max_retries: int = 2,
) -> str | None:
    """Asynchronously stream a chat completion from Groq.

    on_token/on_done/on_error are async callables. on_token receives each
    text delta; on_done receives the concatenated full text; on_error
    receives an error string. Returns the concatenated full text, or None
    if the provider emitted no usable content.

    Token-budgeting and image handling match the synchronous chat() above.
    """
    formatted = list(messages)

    if images:
        last = formatted[-1]
        text = last["content"]
        if is_video_frames:
            text = (
                f"The following {len(images)} images are sequential frames "
                f"sampled evenly across a video, in chronological order. "
                f"Use them together to answer about the video's content/action.\n\n{text}"
            )
        content_blocks = [{"type": "text", "text": text}]
        for img_bytes in images:
            content_blocks.append({
                "type": "image_url",
                "image_url": {"url": image_to_data_url(img_bytes)}
            })
        formatted[-1] = {"role": "user", "content": content_blocks}

    formatted = trim_messages_to_budget(formatted)
    use_model = model or GROQ_MODEL

    last_error = None
    for attempt in range(max_retries):
        try:
            stream = get_client().chat.completions.create(
                model=use_model,
                messages=formatted,
                stream=True,
            )
            collected: list[str] = []
            for chunk in stream:
                # Groq chunks expose delta.content; some providers omit it.
                delta = getattr(getattr(chunk.choices[0], "delta", None), "content", None)
                if not delta:
                    continue
                cleaned = strip_thinking(delta) if delta and "<think>" in delta else delta
                if cleaned:
                    collected.append(cleaned)
                    await on_token(cleaned)
            full_text = "".join(collected).strip()
            if on_done is not None:
                await on_done(full_text)
            return full_text
        except Exception as e:
            last_error = e
            status_code = getattr(e, "status_code", None)
            if status_code == 429:
                wait = (attempt + 1) * 5
                print(f"[stream_chat] Rate limited (429), waiting {wait}s before retry {attempt+1}/{max_retries}...")
                time.sleep(wait)
                continue
            if on_error is not None:
                await on_error(str(e))
            raise

    msg = f"Still rate limited after {max_retries} retries: {last_error}"
    if on_error is not None:
        await on_error(msg)
    raise RuntimeError(msg)

_video_client = None

def get_video_client():
    global _video_client
    if _video_client is None:
        _video_client = OpenAI(
            api_key=os.getenv("NVIDIA_API_KEY"),
            base_url="https://integrate.api.nvidia.com/v1",
        )
    return _video_client


def chat_video_native(messages: list[dict], video_bytes: bytes) -> str:
    video_b64 = base64.b64encode(video_bytes).decode("utf-8")
    last = messages[-1]
    last["content"] = [
        {"type": "text", "text": last["content"]},
        {"type": "video_url", "video_url": {"url": f"data:video/mp4;base64,{video_b64}"}}
    ]
    completion = get_video_client().chat.completions.create(
        model=os.getenv("MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"),
        messages=messages,
    )
    return strip_thinking(completion.choices[0].message.content)
 
def health_check() -> bool:
    try:
        reply = chat([{"role": "user", "content": "Reply with only the word OK."}])
        return "OK" in reply.upper()
    except Exception as e:
        print(f"[health_check] Groq call failed: {e}")
        return False


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.wav") -> str:
    if not filename or filename == "undefined":
        filename = "audio.wav"
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    if not ext:
        ext = "wav"
        filename = f"{filename}.wav"

    mime_map = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "m4a": "audio/mp4",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
        "webm": "audio/webm",
        "mp4": "audio/mp4",
    }
    mime_type = mime_map.get(ext, "audio/wav")

    # Primary: Groq Whisper (ultra-low latency, highly accurate speech recognition)
    try:
        client = get_client()
        transcription = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=(filename, audio_bytes, mime_type),
            response_format="text",
        )
        if isinstance(transcription, str):
            text = transcription.strip()
        else:
            text = (getattr(transcription, "text", None) or "").strip()
        if text:
            return text
    except Exception as e:
        print(f"[transcribe_audio] Groq Whisper failed: {e}. Falling back to NVIDIA...")

    # Fallback: NVIDIA Nemotron if available
    try:
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        audio_data_url = f"data:{mime_type};base64,{audio_b64}"
        audio_model = os.getenv("AUDIO_MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning")
        nvidia_client = get_video_client()
        completion = nvidia_client.chat.completions.create(
            model=audio_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Transcribe the speech in this audio file verbatim into text. Output ONLY the raw transcript with no other words."},
                        {"type": "audio_url", "audio_url": {"url": audio_data_url}},
                    ],
                }
            ],
        )
        reply = completion.choices[0].message.content
        if reply and "can't transcribe" not in reply.lower() and "cannot transcribe" not in reply.lower() and "provide the audio" not in reply.lower():
            return strip_thinking(reply)
    except Exception as e_fallback:
        print(f"[transcribe_audio] NVIDIA fallback failed: {e_fallback}")

    raise RuntimeError("Audio transcription returned empty or failed.")
    
def text_to_speech(text: str, voice: str = "autumn", response_format: str = "wav") -> bytes:
    client = get_client()
    response = client.audio.speech.create(
        model="canopylabs/orpheus-v1-english",
        voice=voice,
        input=text[:9000],
        response_format=response_format,
    )
    return response.read()


# ── Voice-mode enhancements ─────────────────────────────────────────────
# Persona presets for ChatGPT-style voice conversations. Each persona
# injects a system prompt fragment describing how the assistant should
# speak (style, length, tone). Voices still come from Orpheus TTS, but
# the *content* is shaped by the persona.
VOICE_PERSONAS = {
    "default": {
        "label": "Default",
        "description": "Balanced, helpful, conversational.",
        "voice": "autumn",
        "system": "",
    },
    "calm": {
        "label": "Calm",
        "description": "Soft, steady, reassuring — like a mindful companion.",
        "voice": "diana",
        "system": (
            "Speak calmly and reassuringly. Use shorter sentences. "
            "Prefer gentle phrasing over sharp or direct language. "
            "Avoid filler words and exclamation marks."
        ),
    },
    "energetic": {
        "label": "Energetic",
        "description": "Upbeat, warm, expressive.",
        "voice": "hannah",
        "system": (
            "Sound upbeat and energetic. Vary your rhythm — speed up for "
            "exciting moments and slow down for emphasis. Use vivid language "
            "and a touch of enthusiasm. Keep it natural, not theatrical."
        ),
    },
    "professional": {
        "label": "Professional",
        "description": "Concise, precise, business-like.",
        "voice": "austin",
        "system": (
            "Be concise and professional. Prefer precise, well-structured "
            "answers. Avoid filler words and informalities. Get to the point "
            "in the first sentence. Limit answers to two short paragraphs."
        ),
    },
    "friendly": {
        "label": "Friendly",
        "description": "Casual, warm, like chatting with a friend.",
        "voice": "daniel",
        "system": (
            "Be warm, casual, and friendly — like chatting with a good friend. "
            "Use contractions, occasional light humour, and a relaxed rhythm. "
            "Don't be overly formal. Mirror the user's tone."
        ),
    },
}


def get_persona(name: str) -> dict:
    """Return persona config by name, falling back to default."""
    return VOICE_PERSONAS.get(name) or VOICE_PERSONAS["default"]


# Split LLM streaming output into TTS-friendly sentence chunks. Keeps
# short fragments playable without forcing the model to emit full stops.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|(?<=\.)\s+|\n+")
# Soft break points for very long sentences (used as a fallback safety net).
_SOFT_BREAK_RE = re.compile(r"(?<=[,;:])\s+")

MIN_TTS_CHARS = 24     # don't fire TTS for fragments shorter than this
MAX_TTS_CHARS = 220    # force a break on very long sentences


def split_for_tts(text: str) -> list[str]:
    """Split `text` into playable chunks for incremental TTS.

    Returns a list of non-empty strings. Designed so that the first chunk
    arrives quickly (enables low-latency first-audio) and subsequent
    chunks follow at natural sentence boundaries.
    """
    if not text or not text.strip():
        return []

    # First, split on hard sentence boundaries.
    parts = _SENTENCE_SPLIT_RE.split(text.strip())
    chunks: list[str] = []
    buffer = ""

    for part in parts:
        candidate = (buffer + " " + part).strip() if buffer else part.strip()
        # If part alone is too long, try a soft break inside it.
        if len(candidate) > MAX_TTS_CHARS:
            soft = _SOFT_BREAK_RE.split(candidate)
            if len(soft) > 1:
                # Push the buffer, then walk the soft pieces.
                if buffer and len(buffer) >= MIN_TTS_CHARS:
                    chunks.append(buffer.strip())
                    buffer = ""
                for piece in soft:
                    piece = piece.strip()
                    if not piece:
                        continue
                    if len(buffer) + len(piece) + 1 > MAX_TTS_CHARS and buffer:
                        chunks.append(buffer.strip())
                        buffer = piece
                    else:
                        buffer = (buffer + " " + piece).strip() if buffer else piece
                continue
            # No soft break possible — hard cut.
            if buffer:
                chunks.append(buffer.strip())
                buffer = ""
            chunks.append(candidate.strip())
            buffer = ""
            continue

        if len(candidate) >= MIN_TTS_CHARS:
            chunks.append(candidate)
            buffer = ""
        else:
            buffer = candidate

    if buffer:
        chunks.append(buffer.strip())

    return [c for c in chunks if c]


async def stream_chat_for_voice(
    messages: list[dict],
    on_sentence,
    model: str | None = None,
    max_retries: int = 2,
) -> str:
    """Stream an LLM response, calling ``on_sentence(text)`` with each
    TTS-ready chunk as soon as enough text has accumulated.

    on_sentence is an async callable that receives the chunk string.
    Returns the full concatenated response.
    """
    formatted = trim_messages_to_budget(messages)
    use_model = model or GROQ_MODEL
    client = get_client()

    last_error = None
    for attempt in range(max_retries):
        try:
            stream = client.chat.completions.create(
                model=use_model,
                messages=formatted,
                stream=True,
            )
            buffer: list[str] = []
            emitted_text = ""
            for chunk in stream:
                delta = getattr(getattr(chunk.choices[0], "delta", None), "content", None)
                if not delta:
                    continue
                cleaned = strip_thinking(delta) if "<think>" in delta else delta
                if not cleaned:
                    continue
                buffer.append(cleaned)
                joined = "".join(buffer)
                # Try to split into TTS-ready chunks on sentence boundaries.
                tts_chunks = split_for_tts(joined)
                if tts_chunks and len(tts_chunks) > 0:
                    # Emit all chunks except possibly the last (might still grow).
                    # Heuristic: keep the last chunk in buffer only if it doesn't
                    # end with a sentence terminator.
                    last = tts_chunks[-1]
                    ends_hard = last.endswith((".", "!", "?", "\n"))
                    to_emit = tts_chunks[:-1] if not ends_hard else tts_chunks
                    for piece in to_emit:
                        if piece and piece not in emitted_text:
                            await on_sentence(piece)
                            emitted_text += piece + " "
                    # Reset buffer to whatever wasn't emitted.
                    if not ends_hard and last:
                        leftover = joined[joined.rfind(last):]
                        buffer = [leftover]
                    else:
                        buffer = []
            # Flush any remaining buffer at end-of-stream.
            tail = "".join(buffer).strip()
            if tail:
                tail_chunks = split_for_tts(tail)
                for piece in tail_chunks:
                    if piece and piece not in emitted_text:
                        await on_sentence(piece)
                        emitted_text += piece + " "
            return emitted_text.strip()
        except Exception as e:
            last_error = e
            status_code = getattr(e, "status_code", None)
            if status_code == 429:
                wait = (attempt + 1) * 5
                print(f"[stream_chat_for_voice] Rate limited (429), waiting {wait}s...")
                import time as _t
                _t.sleep(wait)
                continue
            raise
    raise RuntimeError(f"Still rate limited after {max_retries} retries: {last_error}")

INTRO_MESSAGE = (
    "Hi, I'm Cortex — your personal assistant. "
    "Tap the microphone and talk to me anytime."
)
NO_INPUT_MESSAGE = (
    "I didn't catch that. Could you try again?"
)
TRANSCRIPTION_ERROR_MESSAGE = (
    "I couldn't process that audio just now. Please try again."
)

_intro_audio_cache: dict[str, bytes] = {}

def get_intro_audio(voice: str = "autumn") -> bytes:
    if voice not in _intro_audio_cache:
        _intro_audio_cache[voice] = text_to_speech(INTRO_MESSAGE, voice=voice)
    return _intro_audio_cache[voice]

def get_no_input_audio(voice: str = "autumn") -> bytes:
    return text_to_speech(NO_INPUT_MESSAGE, voice=voice)


def get_transcription_error_audio(voice: str = "autumn") -> bytes:
    return text_to_speech(TRANSCRIPTION_ERROR_MESSAGE, voice=voice)
