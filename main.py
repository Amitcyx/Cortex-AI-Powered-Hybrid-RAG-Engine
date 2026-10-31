import os
import asyncio
import base64
import json
import shutil
from pathlib import Path
from datetime import datetime
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

load_dotenv()

try:
    import chromadb.telemetry.product.posthog as chroma_posthog
    chroma_posthog.Posthog.capture = lambda *args, **kwargs: None
except Exception:
    pass

from db.models import init_db, save_file_record, get_file_records
from memory import short_term, long_term
from memory import media_memory, unified
from ingestion.loaders import classify_file
from ingestion.embed import ingest_file, ingest_file_with_progress
import ingestion.embed as embed_module
import llm

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(exist_ok=True)
VOICE_MODEL = os.getenv("VOICE_MODEL", os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b"))
MAX_VOICE_AUDIO_BYTES = int(os.getenv("MAX_VOICE_AUDIO_BYTES", 15 * 1024 * 1024))
MAX_VOICE_REPLY_CHARS = int(os.getenv("MAX_VOICE_REPLY_CHARS", 2_000))
MAX_VOICE_TRANSCRIPT_HEADER_CHARS = int(os.getenv("MAX_VOICE_TRANSCRIPT_HEADER_CHARS", 500))
ALLOWED_VOICES = {"autumn", "diana", "hannah", "austin", "daniel", "troy"}
ALLOWED_VOICE_EXTENSIONS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"}

app = FastAPI(title="Cortex: AI-Powered Hybrid RAG Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def limit_voice_reply(text: str) -> str:
    if len(text) <= MAX_VOICE_REPLY_CHARS:
        return text
    clipped = text[:MAX_VOICE_REPLY_CHARS]
    sentence_end = max(clipped.rfind(". "), clipped.rfind("! "), clipped.rfind("? "))
    if sentence_end > MAX_VOICE_REPLY_CHARS // 2:
        clipped = clipped[:sentence_end + 1]
    return clipped.rstrip() + "..."


def header_safe_transcript(text: str) -> str:
    if len(text) <= MAX_VOICE_TRANSCRIPT_HEADER_CHARS:
        return text
    return text[:MAX_VOICE_TRANSCRIPT_HEADER_CHARS].rstrip() + "..."


def build_chat_messages(
    user_id: str,
    session_id: str,
    user_message: str,
    history_limit: int = 6,
    with_unified_context: bool = True,
    extra_context: str | None = None,
    voice_focused: bool = False,
) -> list[dict]:
    """Assemble the OpenAI-style messages list for a chat turn.

    Centralised so /chat and /chat/stream cannot drift apart.
    """
    history = short_term.get_history(user_id, session_id, limit=history_limit)

    today = datetime.now().strftime("%A, %B %d, %Y")
    system_parts = [
        f"You are Cortex, a helpful multimodal AI assistant by Amit Pol. "
        f"The current real-world date is {today}. This is fact, provided by the system clock -- "
        f"treat it as ground truth even if it conflicts with your training data. "
        f"Always use this date if asked what today's date is."
    ]

    if voice_focused:
        system_parts.append(
            "Keep responses conversational and concise: use at most four short sentences, "
            "since this reply will be spoken aloud."
        )

    if with_unified_context:
        context_items = unified.get_unified_context(user_id, user_message, k=4)
        context_block = unified.format_context_for_prompt(context_items)
        if context_block:
            system_parts.append(context_block)

    if extra_context:
        system_parts.append(extra_context)

    system_prompt = {"role": "system", "content": "\n\n".join(system_parts)}
    return [system_prompt] + history + [{"role": "user", "content": user_message}]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    print("[startup] Warming up embedding model + vector store (one-time load)...")
    long_term.preload()
    embed_module.preload()
    media_memory.preload()
    print("[startup] Embedding model ready.")
    if not llm.health_check():
        print("[WARNING] Could not confirm Groq/Qwen3.8-27b is reachable. "
              "Check GROQ_API_KEY in your .env file.")
    else:
        print("[OK] Groq/Qwen3.8-27b is reachable.")
    yield


app.router.lifespan_context = lifespan


@app.get("/")
def root():
    return RedirectResponse(url="/docs")


@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)

class ChatRequest(BaseModel):
    user_id: str
    session_id: str
    message: str


class ChatResponse(BaseModel):
    reply: str


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    messages = build_chat_messages(req.user_id, req.session_id, req.message)
    reply = llm.chat(messages)
    short_term.add_turn(req.user_id, req.session_id, "user", req.message)
    short_term.add_turn(req.user_id, req.session_id, "assistant", reply)
    return ChatResponse(reply=reply)


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    messages = build_chat_messages(req.user_id, req.session_id, req.message)

    short_term.add_turn(req.user_id, req.session_id, "user", req.message)

    queue: asyncio.Queue = asyncio.Queue()

    done_emitted = [False]

    async def on_token(delta: str) -> None:
        await queue.put(("token", delta))

    async def on_done(full_text: str) -> None:
        if not done_emitted[0]:
            done_emitted[0] = True
            await queue.put(("done", full_text))

    async def on_error(message: str) -> None:
        await queue.put(("error", message))

    async def producer() -> None:
        try:
            full = await llm.stream_chat(
                messages,
                on_token=on_token,
                on_done=on_done,
                on_error=on_error,
            )
            if not done_emitted[0] and full is not None:
                done_emitted[0] = True
                await queue.put(("done", full))
        except Exception as exc:
            await queue.put(("error", f"{type(exc).__name__}: {exc}"))
        finally:
            await queue.put(("__end__", ""))

    producer_task = asyncio.create_task(producer())

    async def event_gen():
        try:
            while True:
                kind, payload = await queue.get()
                if kind == "__end__":
                    break
                if kind == "token":
                    yield {"event": "token", "data": payload}
                elif kind == "done":
                    short_term.add_turn(req.user_id, req.session_id, "assistant", payload)
                    yield {"event": "done", "data": payload}
                elif kind == "error":
                    yield {"event": "error", "data": payload}
        finally:
            producer_task.cancel()

    return EventSourceResponse(event_gen())

class ChatWithImageResponse(BaseModel):
    reply: str


@app.post("/chat/image", response_model=ChatWithImageResponse)
async def chat_with_image(
    user_id: str = Form(...),
    session_id: str = Form(...),
    message: str = Form(...),
    image: UploadFile = File(...),
):
    image_bytes = await image.read()
    history = short_term.get_history(user_id, session_id, limit=20)
    today = datetime.now().strftime("%A, %B %d, %Y")
    system_prompt = {"role": "system", "content": f"You are Cortex. Today's date is {today}."}
    messages = [system_prompt] + history + [{"role": "user", "content": message}]

    reply = llm.chat(messages, images=[image_bytes])

    short_term.add_turn(user_id, session_id, "user", f"[image: {image.filename}] {message}")
    short_term.add_turn(user_id, session_id, "assistant", reply)
    media_memory.add_media_memory(user_id, "image", image.filename, reply)

    return ChatWithImageResponse(reply=reply)


class ChatWithVideoResponse(BaseModel):
    reply: str


@app.post("/chat/video", response_model=ChatWithVideoResponse)
async def chat_with_video(
    user_id: str = Form(...),
    session_id: str = Form(...),
    message: str = Form(...),
    video: UploadFile = File(...),
):
    video_bytes = await video.read()
    history = short_term.get_history(user_id, session_id, limit=20)
    messages = history + [{"role": "user", "content": message}]

    reply = llm.chat_video_native(messages, video_bytes)

    short_term.add_turn(user_id, session_id, "user", f"[video: {video.filename}] {message}")
    short_term.add_turn(user_id, session_id, "assistant", reply)
    media_memory.add_media_memory(user_id, "video", video.filename, reply)

    return ChatWithVideoResponse(reply=reply)


class ChatWithAudioResponse(BaseModel):
    transcript: str
    reply: str


@app.post("/chat/audio", response_model=ChatWithAudioResponse)
async def chat_with_audio(
    user_id: str = Form(...),
    session_id: str = Form(...),
    message: str = Form(""),
    audio: UploadFile = File(...),
):
    audio_bytes = await audio.read()
    try:
        transcript = llm.transcribe_audio(audio_bytes, filename=audio.filename or "audio.wav")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Audio transcription failed: {e}")

    if not transcript:
        raise HTTPException(status_code=422, detail="Transcription returned empty text. "
                            "Check that the audio contains speech.")

    full_user_message = transcript
    if message.strip():
        full_user_message = f"{transcript}\n\n[Additional context: {message.strip()}]"

    messages = build_chat_messages(
        user_id, session_id, full_user_message,
        history_limit=20,
        with_unified_context=False,  
    )
    reply = llm.chat(messages)

    short_term.add_turn(user_id, session_id, "user", f"[audio: {audio.filename}] {transcript}")
    short_term.add_turn(user_id, session_id, "assistant", reply)
    media_memory.add_media_memory(user_id, "audio", audio.filename, f"[transcript] {transcript}\n[response] {reply}")

    return ChatWithAudioResponse(transcript=transcript, reply=reply)

@app.get("/speech/intro")
def speech_intro(voice: str = "autumn"):
    if voice not in ALLOWED_VOICES:
        raise HTTPException(status_code=400, detail="Unsupported voice")
    audio = llm.get_intro_audio(voice=voice)
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Content-Length": str(len(audio))},
    )

@app.get("/speech/personas")
def speech_personas():
    """Return the catalog of voice personas (name → label, description, voice)."""
    return {
        "personas": [
            {"name": k, "label": v["label"], "description": v["description"], "voice": v["voice"]}
            for k, v in llm.VOICE_PERSONAS.items()
        ]
    }


@app.post("/chat/speech")
async def chat_speech(
    user_id: str = Form(...),
    session_id: str = Form(...),
    audio: UploadFile = File(...),
    voice: str = Form("autumn"),
):
    if voice not in ALLOWED_VOICES:
        raise HTTPException(status_code=400, detail="Unsupported voice")

    filename = audio.filename or "audio.webm"
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_VOICE_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    if audio.content_type and not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail="Expected an audio upload")

    audio_bytes = await audio.read(MAX_VOICE_AUDIO_BYTES + 1)
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="Audio upload is empty")
    if len(audio_bytes) > MAX_VOICE_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio upload is too large")

    try:
        transcript = llm.transcribe_audio(audio_bytes, filename=filename)
    except Exception as e:
        print(f"[chat_speech] Transcription failed: {e}")
        fallback_audio = llm.get_transcription_error_audio(voice=voice)
        return Response(
            content=fallback_audio,
            media_type="audio/wav",
            headers={
                "X-Transcript": base64.b64encode(b"").decode(),
                "X-Reply-Text": base64.b64encode(llm.TRANSCRIPTION_ERROR_MESSAGE.encode()).decode(),
                "X-Fallback": "true",
                "Content-Length": str(len(fallback_audio)),
            },
        )

    if not transcript:
        fallback_audio = llm.get_no_input_audio(voice=voice)
        return Response(
            content=fallback_audio,
            media_type="audio/wav",
            headers={
                "X-Transcript": base64.b64encode(b"").decode(),
                "X-Reply-Text": base64.b64encode(llm.NO_INPUT_MESSAGE.encode()).decode(),
                "X-Fallback": "true",
                "Content-Length": str(len(fallback_audio)),
            },
        )

    messages = build_chat_messages(
        user_id, session_id, transcript,
        history_limit=20,
        with_unified_context=True,
        voice_focused=True,
    )
    reply = limit_voice_reply(llm.chat(messages, model=VOICE_MODEL))

    short_term.add_turn(user_id, session_id, "user", f"[voice] {transcript}")
    short_term.add_turn(user_id, session_id, "assistant", reply)
    media_memory.add_media_memory(user_id, "audio", filename, f"[transcript] {transcript}\n[response] {reply}")

    reply_audio = llm.text_to_speech(reply, voice=voice)

    return Response(
        content=reply_audio,
        media_type="audio/wav",
        headers={
            "X-Transcript": base64.b64encode(header_safe_transcript(transcript).encode()).decode(),
            "X-Reply-Text": base64.b64encode(reply.encode()).decode(),
            "Content-Length": str(len(reply_audio)),
        },
    )


@app.post("/speech/transcribe")
async def speech_transcribe(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="Audio file is empty")
    filename = audio.filename or "audio.webm"
    try:
        transcript = llm.transcribe_audio(audio_bytes, filename=filename)
        return {"transcript": transcript}
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Transcription failed: {e}")


@app.post("/upload")
async def upload_file(user_id: str = Form(...), file: UploadFile = File(...)):
    safe_user_id = Path(user_id).name or "anon"
    dest_path = UPLOAD_DIR / f"{safe_user_id}_{file.filename}"
    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    filetype = classify_file(file.filename)
    result = ingest_file(safe_user_id, str(dest_path), file.filename, chat_fn=llm.chat)

    save_file_record(
        safe_user_id, file.filename, str(dest_path), filetype,
        summary=result.get("summary"),
        mermaid_diagram=result.get("mermaid_diagram"),
    )

    return {"filename": file.filename, **result}


@app.post("/upload/stream")
async def upload_file_stream(user_id: str = Form(...), file: UploadFile = File(...)):
    safe_user_id = Path(user_id).name or "anon"
    dest_path = UPLOAD_DIR / f"{safe_user_id}_{file.filename}"

    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    filetype = classify_file(file.filename)
    if filetype in ("image", "video"):
        async def immediate_gen():
            yield {
                "event": "done",
                "data": json.dumps({
                    "stage": "complete",
                    "progress": 100,
                    "message": "Ready (multimodal media)",
                    "filetype": filetype,
                }),
            }
        return EventSourceResponse(immediate_gen())

    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def progress_callback(stage: str, percent: int, message: str, extra: dict = None):
        payload = {"stage": stage, "progress": percent, "message": message, **(extra or {})}
        asyncio.run_coroutine_threadsafe(queue.put(("progress", payload)), loop)

    def worker():
        try:
            result = ingest_file_with_progress(
                safe_user_id,
                str(dest_path),
                file.filename,
                chat_fn=llm.chat,
                progress_callback=progress_callback,
            )
            save_file_record(
                safe_user_id,
                file.filename,
                str(dest_path),
                filetype,
                summary=result.get("summary"),
                mermaid_diagram=result.get("mermaid_diagram"),
            )
            asyncio.run_coroutine_threadsafe(
                queue.put((
                    "done",
                    {
                        "stage": "complete",
                        "progress": 100,
                        "message": f"Successfully indexed {file.filename}",
                        "result": result,
                    },
                )),
                loop,
            )
        except Exception as exc:
            import traceback
            traceback.print_exc()
            asyncio.run_coroutine_threadsafe(
                queue.put((
                    "error",
                    {
                        "stage": "error",
                        "progress": 0,
                        "message": f"Indexing failed: {exc}",
                    },
                )),
                loop,
            )
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(("__end__", None)), loop)

    worker_task = asyncio.create_task(asyncio.to_thread(worker))

    async def event_generator():
        try:
            while True:
                event_type, payload = await queue.get()
                if event_type == "__end__":
                    break
                yield {"event": event_type, "data": json.dumps(payload)}
        finally:
            if not worker_task.done():
                worker_task.cancel()

    return EventSourceResponse(event_generator())



@app.get("/files")
def list_files(user_id: str):
    safe_user_id = Path(user_id).name or "anon"
    return {"files": get_file_records(safe_user_id)}


@app.post("/memory/consolidate")
def consolidate_memory(user_id: str, session_id: str):
    history = short_term.get_history(user_id, session_id, limit=40)
    if not history:
        raise HTTPException(status_code=404, detail="No conversation history found")

    conversation_text = "\n".join(f"{m['role']}: {m['content']}" for m in history)
    facts = long_term.remember_from_conversation(user_id, llm.chat, conversation_text)
    return {"facts_extracted": facts}


@app.get("/health")
def health():
    return {"model_reachable": llm.health_check()}


async def _ws_send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except Exception:
        pass


async def _run_voice_turn(
    ws: WebSocket,
    state: dict,
    user_text: str,
) -> None:
    """Stream one assistant turn with per-sentence TTS; honour cancellation."""
    user_id = state["user_id"]
    session_id = state["session_id"]
    persona = llm.get_persona(state.get("persona", "default"))
    voice = state.get("voice") or persona["voice"]

    short_term.add_turn(user_id, session_id, "user", f"[voice] {user_text}")

    messages = build_chat_messages(
        user_id, session_id, user_text,
        history_limit=10,
        with_unified_context=True,
        voice_focused=True,
    )
    if persona.get("system"):
        sys_msg = messages[0]
        sys_msg["content"] = (sys_msg.get("content", "") + "\n\n" + persona["system"]).strip()

    full_parts: list[str] = []
    seq = 0
    cancel_token = [False]
    state["cancel_token"] = cancel_token

    async def on_sentence(text: str) -> None:
        nonlocal seq
        if cancel_token[0]:
            return
        full_parts.append(text)
        await _ws_send(ws, {"type": "assistant_delta", "text": text})
        try:
            loop = asyncio.get_running_loop()
            audio = await loop.run_in_executor(
                None, lambda t=text, v=voice: llm.text_to_speech(t, voice=v)
            )
            seq += 1
            await _ws_send(ws, {
                "type": "assistant_audio",
                "seq": seq,
                "b64": base64.b64encode(audio).decode("ascii"),
            })
        except Exception as e:
            print(f"[voice] TTS failed: {e}")

    llm_task = asyncio.create_task(llm.stream_chat_for_voice(
        messages, on_sentence=on_sentence, model=VOICE_MODEL,
    ))

    try:
        while not llm_task.done():
            await asyncio.sleep(0.05)
            if cancel_token[0]:
                llm_task.cancel()
                break
    except asyncio.CancelledError:
        llm_task.cancel()

    full_reply = " ".join(full_parts).strip()
    if cancel_token[0]:
        await _ws_send(ws, {"type": "interrupted"})
    elif full_reply:
        short_term.add_turn(user_id, session_id, "assistant", full_reply)
        media_memory.add_media_memory(
            user_id, "audio", "voice.wav",
            f"[transcript] {user_text}\n[response] {full_reply}",
        )
        await _ws_send(ws, {"type": "turn_done", "full": full_reply})
    else:
        await _ws_send(ws, {"type": "error", "message": "Empty response"})

    state["cancel_token"] = None
    state["turn_in_flight"] = False


@app.websocket("/voice/stream")
async def voice_stream(ws: WebSocket):
    await ws.accept()
    state: dict = {
        "user_id": "user_default",
        "session_id": "default",
        "persona": "default",
        "voice": None,
        "audio_buf": bytearray(),
        "cancel_token": None,
        "turn_in_flight": False,
    }

    async def run_text_turn(text: str) -> None:
        """Helper for typed turns."""
        if not text or state["turn_in_flight"]:
            return
        await _ws_send(ws, {"type": "user_transcript", "text": text})
        state["turn_in_flight"] = True
        await _run_voice_turn(ws, state, text)

    try:
        while True:
            msg = await ws.receive()

            if "text" not in msg:
                continue
            try:
                data = json.loads(msg["text"])
            except json.JSONDecodeError:
                await _ws_send(ws, {"type": "error", "message": "Bad JSON"})
                continue

            kind = data.get("type")

            if kind == "start":
                state["user_id"] = data.get("user_id") or "user_default"
                state["session_id"] = data.get("session_id") or "default"
                persona_name = data.get("persona") or "default"
                state["persona"] = persona_name
                persona = llm.get_persona(persona_name)
                state["voice"] = persona["voice"]
                state["audio_buf"] = bytearray()
                state["turn_in_flight"] = False
                if state.get("cancel_token"):
                    state["cancel_token"][0] = True
                await _ws_send(ws, {
                    "type": "ready",
                    "persona": persona_name,
                    "voice": state["voice"],
                })

            elif kind == "audio":
                if state["turn_in_flight"]:
                    continue
                b64 = data.get("b64", "")
                if not b64:
                    continue
                try:
                    state["audio_buf"].extend(base64.b64decode(b64))
                except Exception as e:
                    await _ws_send(ws, {"type": "error", "message": f"Bad audio: {e}"})

            elif kind == "stop":
                if state["turn_in_flight"]:
                    continue
                audio_bytes = bytes(state["audio_buf"])
                state["audio_buf"] = bytearray()
                if not audio_bytes:
                    await _ws_send(ws, {"type": "user_transcript", "text": ""})
                    continue
                try:
                    loop = asyncio.get_running_loop()
                    transcript = await loop.run_in_executor(
                        None,
                        lambda: llm.transcribe_audio(audio_bytes, filename="voice.webm"),
                    )
                except Exception as e:
                    await _ws_send(ws, {"type": "error", "message": f"Transcribe failed: {e}"})
                    continue
                transcript = (transcript or "").strip()
                if not transcript:
                    await _ws_send(ws, {"type": "user_transcript", "text": ""})
                    continue
                await _ws_send(ws, {"type": "user_transcript", "text": transcript})
                state["turn_in_flight"] = True
                try:
                    await _run_voice_turn(ws, state, transcript)
                except Exception as turn_err:
                    print(f"[voice/stream] turn error: {turn_err}")
                    await _ws_send(ws, {"type": "error", "message": f"Turn error: {turn_err}"})
                finally:
                    state["turn_in_flight"] = False

            elif kind == "interrupt":
                if state.get("cancel_token"):
                    state["cancel_token"][0] = True
                await _ws_send(ws, {"type": "interrupted"})

            elif kind == "persona":
                name = data.get("persona") or "default"
                state["persona"] = name
                persona = llm.get_persona(name)
                state["voice"] = persona["voice"]
                await _ws_send(ws, {
                    "type": "persona_updated",
                    "persona": name,
                    "voice": state["voice"],
                })

            elif kind == "text":
                await run_text_turn((data.get("text") or "").strip())

            elif kind == "end":
                break

            else:
                await _ws_send(ws, {"type": "error", "message": f"Unknown type: {kind}"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[voice/stream] error: {e}")
        try:
            await _ws_send(ws, {"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if state.get("cancel_token"):
            state["cancel_token"][0] = True
        await _ws_send(ws, {"type": "bye"})