"""
Shared ChromaDB client + embedding function.

Previously long_term.py, media_memory.py, and embed.py each maintained their
own module-level PersistentClient and SentenceTransformerEmbeddingFunction,
all pointed at the same CHROMA_PATH. That meant:
  - the embedding model got loaded into memory three separate times at
    startup (each module's preload() triggered its own copy), and
  - three independent PersistentClient instances wrote to the same
    SQLite-backed path from a single process, which Chroma's docs explicitly
    warn against (instance-settings conflicts / lock contention).

This module centralizes both singletons so every caller shares one client,
one embedding function, and one collection object per name.

NOTE ON PLACEMENT: this file should live at db/chroma_client.py alongside
db/models.py (import it as `from db.chroma_client import ...`), since both
memory/ and ingestion/ already import sibling-level modules from db/. It's
named db_chroma_client.py here only because this sandbox doesn't have your
package directories -- rename the file and drop it in db/ when you copy it
into the project.
"""

import os
import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions

CHROMA_PATH = os.getenv("CHROMA_PATH", "./chroma_db")
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")

_chroma_client = None
_embedding_fn = None
_collections: dict = {}


def get_client():
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(
            path=CHROMA_PATH,
            settings=Settings(anonymized_telemetry=False),
        )
    return _chroma_client


def get_embedding_fn():
    global _embedding_fn
    if _embedding_fn is None:
        _embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=EMBEDDING_MODEL_NAME
        )
    return _embedding_fn


def get_collection(name: str):
    """Return a cached collection handle, creating it (and the client/
    embedding function, if not already loaded) on first use."""
    if name not in _collections:
        _collections[name] = get_client().get_or_create_collection(
            name=name, embedding_function=get_embedding_fn()
        )
    return _collections[name]


def preload(*collection_names: str):
    """Warm the embedding model and the given collections once, up front.
    Safe to call multiple times / from multiple modules -- all but the first
    call are no-ops thanks to the singleton caches above."""
    get_embedding_fn()
    for name in collection_names:
        get_collection(name)
