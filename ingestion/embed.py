from ingestion.loaders import (
    classify_file,
    load_text,
    chunk_text,
    load_pdf_pages_with_progress,
    chunk_pages,
)
from ingestion.summarize import generate_document_summary
from db.chroma_client import get_collection, preload as _preload_shared


def _get_docs_collection():
    return get_collection("user_documents")


def preload():
    _preload_shared("user_documents")


def ingest_file_with_progress(
    user_id: str,
    filepath: str,
    filename: str,
    chat_fn=None,
    progress_callback=None,
) -> dict:
    """
    Ingests and indexes a document with progress updates and batched vector storage,
    specifically designed to scale to 2,000-3,000+ page documents without memory exhaustion.

    progress_callback signature:
        progress_callback(stage: str, percent: int, message: str, extra: dict = None)
    """
    filetype = classify_file(filename)

    if filetype in ("image", "video"):
        if progress_callback:
            progress_callback("complete", 100, "Multimodal media ready for chat.")
        return {"filetype": filetype, "chunks_indexed": 0, "note": "handled via vision model, not embedded"}

    # ── Stage 1: Text extraction (5% - 35%) ─────────────────────────────────
    if progress_callback:
        progress_callback("parsing", 5, f"Reading {filename}...")

    total_pages = 1
    chunks_with_meta = []
    full_text_sample = ""

    if filetype == "pdf":
        def on_pdf_page(current, total):
            if progress_callback:
                pct = 5 + int((current / total) * 30)
                progress_callback(
                    "parsing",
                    pct,
                    f"Reading page {current:,} of {total:,} ({pct}%)",
                    {"page": current, "total_pages": total},
                )

        pages = load_pdf_pages_with_progress(filepath, progress_callback=on_pdf_page)
        total_pages = len(pages)
        if not pages:
            if progress_callback:
                progress_callback("error", 0, "No extractable text found in PDF.")
            return {"filetype": filetype, "chunks_indexed": 0, "note": "no extractable text"}

        # First 15 pages sample for summary
        full_text_sample = "\n\n".join(p["text"] for p in pages[:15])

        # ── Stage 2: Chunking (35% - 40%) ───────────────────────────────────
        if progress_callback:
            progress_callback("chunking", 36, f"Splitting {total_pages:,} pages into sentence-aligned chunks...")

        chunks_with_meta = chunk_pages(pages, chunk_size=500, overlap_sentences=1)
    else:
        text = load_text(filepath, filetype)
        if not text.strip():
            if progress_callback:
                progress_callback("error", 0, "File is empty.")
            return {"filetype": filetype, "chunks_indexed": 0, "note": "no extractable text"}

        full_text_sample = text[:15000]
        if progress_callback:
            progress_callback("chunking", 36, "Splitting document into sentence-aligned chunks...")

        raw_chunks = chunk_text(text, chunk_size=500, overlap_sentences=1)
        chunks_with_meta = [{"text": c, "page": 1, "chunk_index": i} for i, c in enumerate(raw_chunks)]

    total_chunks = len(chunks_with_meta)
    if total_chunks == 0:
        if progress_callback:
            progress_callback("error", 0, "No text chunks generated.")
        return {"filetype": filetype, "chunks_indexed": 0, "note": "no chunks"}

    # ── Stage 3: Embedding & Upserting into ChromaDB in Batches (40% - 90%) ──
    collection = _get_docs_collection()
    batch_size = 100  # Safe batch size to prevent SQLite parameter limits & PyTorch OOM
    total_batches = (total_chunks + batch_size - 1) // batch_size

    for b_idx in range(total_batches):
        start = b_idx * batch_size
        end = min(start + batch_size, total_chunks)
        batch = chunks_with_meta[start:end]

        batch_ids = [f"{user_id}-{filename}-{item['chunk_index']}" for item in batch]
        batch_docs = [item["text"] for item in batch]
        batch_metas = [
            {
                "user_id": user_id,
                "filename": filename,
                "chunk_index": item["chunk_index"],
                "page": item.get("page", 1),
            }
            for item in batch
        ]

        collection.upsert(ids=batch_ids, documents=batch_docs, metadatas=batch_metas)

        if progress_callback:
            pct = 40 + int((end / total_chunks) * 50)
            progress_callback(
                "indexing",
                pct,
                f"Embedding into vector database: {end:,}/{total_chunks:,} chunks ({pct}%)",
                {"indexed": end, "total_chunks": total_chunks, "batch": b_idx + 1, "total_batches": total_batches},
            )

    # Invalidate BM25 cache for this user since docs changed
    try:
        from ingestion.vlrag import invalidate_bm25_cache
        invalidate_bm25_cache(user_id)
    except ImportError:
        pass

    result = {
        "filetype": filetype,
        "chunks_indexed": total_chunks,
        "total_pages": total_pages,
    }

    # ── Stage 4: AI Summary & Mermaid Diagram (90% - 99%) ───────────────────
    if chat_fn is not None:
        if progress_callback:
            progress_callback("summarizing", 92, "Generating AI document summary and Mermaid diagram...")
        try:
            summary_data = generate_document_summary(chat_fn, filename, full_text_sample)
            result["summary"] = summary_data.get("summary")
            result["mermaid_diagram"] = summary_data.get("mermaid")
        except Exception as e:
            result["summary_error"] = str(e)

    # ── Stage 5: Ready (100%) ───────────────────────────────────────────────
    if progress_callback:
        progress_callback(
            "complete",
            100,
            f"Successfully indexed {total_chunks:,} chunks into database.",
            {"chunks_indexed": total_chunks, "total_pages": total_pages},
        )

    return result


def ingest_file(user_id: str, filepath: str, filename: str, chat_fn=None) -> dict:
    """Synchronous non-progress wrapper for backward compatibility."""
    return ingest_file_with_progress(user_id, filepath, filename, chat_fn=chat_fn)


def retrieve_relevant_chunks_scored(user_id: str, query: str, k: int = 4) -> list[dict]:
    collection = _get_docs_collection()
    if collection.count() == 0:
        return []
    results = collection.query(
        query_texts=[query],
        n_results=min(k, collection.count()),
        where={"user_id": user_id},
    )
    docs = results.get("documents", [[]])[0]
    distances = results.get("distances", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    return [
        {
            "text": doc,
            "distance": dist,
            "source_type": "document",
            "filename": meta.get("filename", "unknown file"),
            "page": meta.get("page", 1),
        }
        for doc, dist, meta in zip(docs, distances, metadatas)
    ]
