import hashlib
import re
from db.chroma_client import get_collection, preload as _preload_shared


def preload():
    _preload_shared("user_facts")


def _get_facts_collection():
    return get_collection("user_facts")


# ── Fact Cleaning ─────────────────────────────────────────────────────────
# Patterns that indicate LLM reasoning artifacts, not real facts.
_NOISE_PATTERNS = [
    re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE),
    re.compile(r"^thinking\s*(process)?[:.]", re.IGNORECASE),
    re.compile(r"^(here are|below are|the following|i (found|extracted|identified))", re.IGNORECASE),
    re.compile(r"^(note:|disclaimer:|caveat:)", re.IGNORECASE),
    re.compile(r"^\*?\s*fact\s*\d*\s*:", re.IGNORECASE),
    re.compile(r"^\*?\s*refinement:", re.IGNORECASE),
]

def _clean_fact(raw: str) -> str:
    """Strip LLM reasoning artifacts, bullet markers, and normalize whitespace."""
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL | re.IGNORECASE).strip()
    # Remove leading bullet markers: -, *, •, numbered lists
    text = re.sub(r"^[\-\*\•]\s*", "", text)
    text = re.sub(r"^\d+[\.\)]\s*", "", text)
    # Remove leading "Fact N:" or "* Fact N:" prefixes
    text = re.sub(r"^\*?\s*fact\s*\d*\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^\*?\s*refinement\s*:\s*", "", text, flags=re.IGNORECASE)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _is_valid_fact(text: str) -> bool:
    """Return False for noise lines that should not be stored as facts."""
    if not text or len(text) < 10:
        return False
    if len(text) > 500:
        return False  # Too long to be a concise fact
    for pattern in _NOISE_PATTERNS:
        if pattern.search(text):
            return False
    # Reject lines that are mostly non-alphanumeric (formatting artifacts)
    alpha_ratio = sum(1 for c in text if c.isalpha()) / max(len(text), 1)
    if alpha_ratio < 0.4:
        return False
    return True


def add_fact(user_id: str, fact: str):
    cleaned = _clean_fact(fact)
    if not _is_valid_fact(cleaned):
        return  # Silently skip noise
    collection = _get_facts_collection()
    fact_hash = hashlib.sha256(cleaned.encode("utf-8")).hexdigest()
    fact_id = f"{user_id}-{fact_hash}"
    collection.upsert(
        ids=[fact_id],
        documents=[cleaned],
        metadatas=[{"user_id": user_id}],
    )
 
 
def get_relevant_facts_scored(user_id: str, query: str, k: int = 5) -> list[dict]:
    collection = _get_facts_collection()
    if collection.count() == 0:
        return []
    results = collection.query(
        query_texts=[query],
        n_results=min(k, collection.count()),
        where={"user_id": user_id},
    )
    docs = results.get("documents", [[]])[0]
    distances = results.get("distances", [[]])[0]
    # Post-filter: skip any previously-stored dirty facts still in the DB
    filtered = []
    for doc, dist in zip(docs, distances):
        if _is_valid_fact(doc):
            filtered.append({"text": doc, "distance": dist, "source_type": "fact"})
    return filtered[:k]
 
 
def extract_facts_from_conversation(chat_fn, conversation_text: str) -> list[str]:
    prompt = (
        "Extract any durable facts about the USER from this conversation "
        "(preferences, projects, role, tools they use, ongoing goals). "
        "Ignore one-off details. Return each fact as a short standalone "
        "sentence, one per line. If there are no durable facts, return nothing.\n\n"
        f"Conversation:\n{conversation_text}"
    )
    response = chat_fn([{"role": "user", "content": prompt}])
    raw_lines = [line.strip("- ").strip() for line in response.splitlines() if line.strip()]
    # Clean and validate each extracted fact
    facts = []
    for raw in raw_lines:
        cleaned = _clean_fact(raw)
        if _is_valid_fact(cleaned):
            facts.append(cleaned)
    return facts
 
 
def remember_from_conversation(user_id: str, chat_fn, conversation_text: str):
    facts = extract_facts_from_conversation(chat_fn, conversation_text)
    for fact in facts:
        add_fact(user_id, fact)
    return facts