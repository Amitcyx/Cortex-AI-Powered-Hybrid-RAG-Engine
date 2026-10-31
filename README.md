# Cortex: AI-Powered Hybrid RAG Engine

A multimodal AI chat assistant (text + image + video + audio + real-time voice mode) with persistent memory, hybrid RAG over uploaded documents, and a polished React workspace.

Developed by **Amit Pol**.

---

## Overview & Architecture

- **Backend**: FastAPI | SQLite | ChromaDB | Groq API + NVIDIA NIM
- **Frontend**: React 18 | Vite | Framer Motion | Lucide Icons | WebSockets
- **Hybrid RAG**: Vector Search (`all-MiniLM-L6-v2`) + BM25 Lexical Search (`RRF k=60`) + MS-MARCO Cross-Encoder Re-ranking (`ms-marco-MiniLM-L-6-v2`)
- **Multimodal**: Text, Image, Native Video (Nemotron), Audio Transcription (Whisper Large v3), Voice Output (Orpheus TTS)

---

## Quick Start

### 1. Prerequisites

- Python 3.11+
- Node.js 18+ and npm
- Groq API Key ([console.groq.com](https://console.groq.com))
- NVIDIA API Key ([build.nvidia.com](https://build.nvidia.com)) *(optional, for video understanding)*

### 2. Configure Environment

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
# Edit .env and set your GROQ_API_KEY and NVIDIA_API_KEY
```

### 3. Backend Setup

```bash
# Create and activate virtual environment
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
# source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Start FastAPI server
uvicorn main:app --reload --port 8000
```

The backend interactive API docs will be available at `http://localhost:8000/docs`.

### 4. Frontend Setup

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. The Vite dev server proxies `/api/*` and `/voice/stream` WebSocket to `:8000`.

---

## Core Features

- **Conversational Text Chat**: Streaming SSE responses with context-aware token budgeting.
- **Multimodal Intelligence**:
  - **Images**: Visual reasoning via Groq vision models.
  - **Video**: Native video understanding via NVIDIA Nemotron-3-Nano-Omni.
  - **Audio**: Speech-to-text with Groq Whisper Large v3 (with Nemotron fallback).
- **Real-Time Voice Mode**:
  - Full-duplex WebSocket streaming (`/voice/stream`).
  - Sentence-by-sentence TTS for low-latency voice responses.
  - Interactive Voice Orb with real-time Web Audio API waveform visualizer.
  - Persona selection (`Default`, `Calm`, `Energetic`, `Professional`, `Friendly`).
  - Barge-in cancellation (interrupt the assistant mid-speech).
- **Two-Stage Hybrid RAG**:
  - Sentence-aware document chunking (preserves paragraph and grammatical boundaries).
  - Reciprocal Rank Fusion (RRF) combining dense semantic search (ChromaDB) and sparse keyword matching (BM25 with custom stemming and stopword filtering).
  - Neural Cross-Encoder re-ranking (`ms-marco-MiniLM-L-6-v2`) with dynamic noise thresholding.
- **Tiered Persistent Memory**:
  - **Short-Term Memory**: Turn-by-turn history tracked in SQLite.
  - **Long-Term Facts**: Automatic fact consolidation (`/memory/consolidate`) extracting user preferences and projects into ChromaDB.
  - **Media Memory**: Descriptions of uploaded media for cross-session recall.
- **Document Summaries & Diagrams**: Auto-generates high-level summaries and Mermaid.js architecture diagrams upon file upload.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/chat` | Standard text chat turn |
| `POST` | `/chat/stream` | Server-Sent Events (SSE) token stream |
| `POST` | `/chat/image` | Image + text prompt |
| `POST` | `/chat/video` | Video + text prompt |
| `POST` | `/chat/audio` | Audio file upload + transcription + reply |
| `POST` | `/chat/speech` | Push-to-talk voice in -> voice out (WAV) |
| `WS`   | `/voice/stream`| Full-duplex real-time voice streaming WebSocket |
| `POST` | `/speech/transcribe` | Audio file speech-to-text transcription |
| `GET`  | `/speech/personas` | Catalog of voice personas and system prompt styles |
| `POST` | `/upload` | Document upload and RAG ingestion (PDF, code, text) |
| `POST` | `/upload/stream` | Document upload with live SSE indexing progress stream |
| `GET`  | `/files` | List uploaded files for a user |
| `POST` | `/memory/consolidate` | Extract long-term facts from conversation |
| `GET`  | `/health` | LLM and Groq connectivity health check |

---

## Project Structure

```text
.
├── main.py                 # FastAPI application and route handlers
├── llm.py                  # Groq & NVIDIA client wrappers, TTS/STT, and streaming
├── requirements.txt        # Python backend dependencies
├── package.json            # Workspace root npm scripts
├── db/
│   ├── models.py           # SQLite schema and query functions
│   └── chroma_client.py    # Shared ChromaDB singleton client and embedding function
├── ingestion/
│   ├── loaders.py          # PDF/Code text extractors and sentence-aware chunking
│   ├── embed.py            # ChromaDB ingestion and indexing
│   ├── vlrag.py            # BM25 search with custom stemmer and cache
│   └── summarize.py        # Automated document summary and Mermaid diagram generation
├── memory/
│   ├── short_term.py       # Short-term conversation turn management
│   ├── long_term.py        # Long-term fact extraction and retrieval
│   ├── media_memory.py     # Multimodal media descriptions memory
│   ├── rerank.py           # Cross-Encoder re-ranking and noise filtering
│   └── unified.py          # Unified context fusion (RRF + Intent detection)
├── frontend/
│   ├── package.json        # Frontend React dependencies
│   ├── vite.config.js      # Vite configuration and proxy setup
│   └── src/
│       ├── App.jsx         # Main application layout and state
│       ├── api/            # API client and endpoints (REST, SSE, WebSocket)
│       ├── components/     # UI components (Chat, Voice, Sidebar, Modals)
│       └── hooks/          # React hooks (useVoiceSession, useConversations, etc.)
└── uploads/                # Directory for user-uploaded documents (git-ignored)
```

---

## Security Notes

- `.env` is git-ignored. Never commit real API keys to version control.
- `user_id` is a client-supplied identifier. For public production deployments, add an authentication layer (e.g., JWT / OAuth2 bearer tokens) to protect endpoints.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.