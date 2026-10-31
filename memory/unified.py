from memory.long_term import get_relevant_facts_scored
from memory.media_memory import get_relevant_media_scored
from ingestion.embed import retrieve_relevant_chunks_scored
from ingestion.vlrag import bm25_search
from memory.rerank import rerank_and_filter

RRF_K = 60


def _normalize_distances(items: list[dict]) -> list[dict]:
    """Min-max normalize the 'distance' field of a list of scored items onto
    [0, 1], so distances from different sources (cosine distance, RRF score,
    BM25 score, etc.) can be safely compared/sorted together."""
    if not items:
        return items

    distances = [item["distance"] for item in items]
    lo, hi = min(distances), max(distances)
    spread = hi - lo

    if spread == 0:
        for item in items:
            item["distance"] = 0.0
        return items

    for item in items:
        item["distance"] = (item["distance"] - lo) / spread
    return items


def _fuse_document_results(vector_results: list[dict], keyword_results: list[dict]) -> list[dict]:
    fused_scores: dict[str, float] = {}
    text_by_key: dict[str, dict] = {}

    for rank, item in enumerate(vector_results):
        key = item["text"][:100]  # dedupe key
        fused_scores[key] = fused_scores.get(key, 0) + 1 / (RRF_K + rank)
        text_by_key[key] = item

    for rank, item in enumerate(keyword_results):
        key = item["text"][:100]
        fused_scores[key] = fused_scores.get(key, 0) + 1 / (RRF_K + rank)
        if key not in text_by_key:
            text_by_key[key] = item

    ranked_keys = sorted(fused_scores, key=fused_scores.get, reverse=True)
    return [
        {"text": text_by_key[k]["text"], "filename": text_by_key[k]["filename"],
         "source_type": "document", "distance": -fused_scores[k]}
        for k in ranked_keys
    ]


# ── Source-Aware Intent Detection ─────────────────────────────────────────

_DOC_SIGNALS = {
    "file", "document", "pdf", "code", "upload", "page", "chapter",
    "section", "table", "function", "class", "method", "api", "schema",
    "database", "query", "sql", "html", "css", "xml", "dtd", "xsl",
    "servlet", "jsp", "struts", "assignment", "lab", "syllabus",
    "implement", "design", "create", "build", "display", "program",
}

_FACT_SIGNALS = {
    "prefer", "like", "use", "goal", "project", "building", "working",
    "favorite", "interested", "role", "stack", "language", "framework",
    "remember", "told", "mentioned", "said", "my", "i",
}

_MEDIA_SIGNALS = {
    "audio", "video", "image", "photo", "picture", "recording",
    "transcript", "voice", "said", "hear", "watch", "saw", "listen",
}


def _detect_intent(query: str) -> str:
    """Classify query intent as 'document', 'fact', 'media', or 'mixed'."""
    words = set(query.lower().split())

    doc_score = len(words & _DOC_SIGNALS)
    fact_score = len(words & _FACT_SIGNALS)
    media_score = len(words & _MEDIA_SIGNALS)

    total = doc_score + fact_score + media_score
    if total == 0:
        return "mixed"

    if doc_score > fact_score and doc_score > media_score:
        return "document"
    if fact_score > doc_score and fact_score > media_score:
        return "fact"
    if media_score > doc_score and media_score > fact_score:
        return "media"
    return "mixed"


def get_unified_context(user_id: str, query: str, k: int = 6) -> list[dict]:
    """
    Two-stage retrieval pipeline:
    Stage 1: Broad multi-source candidate fetch (Vector + BM25 RRF + Facts + Media)
    Stage 2: Neural Cross-Encoder Re-ranking + Dynamic Noise Thresholding
    """
    intent = _detect_intent(query)

    # First stage: retrieve broad candidate pool (up to 12-16 candidates total)
    pool_k = max(k * 2, 10)
    if intent == "document":
        doc_k, fact_k, media_k = pool_k, 3, 3
    elif intent == "fact":
        doc_k, fact_k, media_k = 4, pool_k, 3
    elif intent == "media":
        doc_k, fact_k, media_k = 4, 3, pool_k
    else:
        doc_k, fact_k, media_k = pool_k, 5, 5

    facts = _normalize_distances(get_relevant_facts_scored(user_id, query, k=fact_k))
    media = _normalize_distances(get_relevant_media_scored(user_id, query, k=media_k))

    vector_docs = retrieve_relevant_chunks_scored(user_id, query, k=doc_k)
    keyword_docs = bm25_search(user_id, query, k=doc_k)
    fused_docs = _normalize_distances(_fuse_document_results(vector_docs, keyword_docs)[:doc_k])

    # Deduplicate candidates across sources
    candidates = []
    seen = set()
    for item in (fused_docs + facts + media):
        dedup_key = item["text"].strip()[:120]
        if dedup_key not in seen:
            seen.add(dedup_key)
            candidates.append(item)

    if not candidates:
        return []

    # Stage 2: Cross-Encoder Re-ranking and Confidence Thresholding
    reranked = rerank_and_filter(query, candidates, top_k=k, min_score=-5.5)
    return reranked


def format_context_for_prompt(context_items: list[dict], max_chars: int = 2000) -> str:
    if not context_items:
        return ""

    lines = []
    total_chars = 0
    for item in context_items:
        source = item.get("source_type", "document")
        filename = item.get("filename", "unknown")
        if source == "fact":
            line = f"- [remembered fact] {item['text']}"
        elif source == "document":
            line = f"- [from file '{filename}'] {item['text'][:300]}"
        else:
            line = f"- [from {source} '{filename}'] {item['text'][:300]}"

        if total_chars + len(line) > max_chars:
            break
        lines.append(line)
        total_chars += len(line)

    return "Relevant things Cortex knows or has seen (across chat, files, images, video, and audio):\n" + "\n".join(lines)