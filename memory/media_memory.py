import hashlib
from db.chroma_client import get_collection, preload as _preload_shared


def _get_media_collection():
    return get_collection("user_media")


def preload():
    _preload_shared("user_media")


def add_media_memory(user_id: str, source_type: str, filename: str, description: str):
    collection = _get_media_collection()
    description_hash = hashlib.sha256(description.encode("utf-8")).hexdigest()
    media_id = f"{user_id}-{filename}-{description_hash}"
    collection.upsert(
        ids=[media_id],
        documents=[description],
        metadatas=[{"user_id": user_id, "source_type": source_type, "filename": filename}],
    )


def get_relevant_media_scored(user_id: str, query: str, k: int = 4) -> list[dict]:
    collection = _get_media_collection()
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
        {"text": doc, "distance": dist, "source_type": meta.get("source_type", "media"), "filename": meta.get("filename", "unknown file")}
        for doc, dist, meta in zip(docs, distances, metadatas)
    ]