import re
import time
from rank_bm25 import BM25Okapi
from ingestion.embed import _get_docs_collection


# ── Fix #3: Better BM25 Tokenizer ────────────────────────────────────────
# Lightweight stemming, stopword removal, and punctuation stripping
# without requiring nltk.

# Common English stopwords (top ~120 most frequent function words)
_STOPWORDS = frozenset({
    "a", "about", "above", "after", "again", "against", "all", "am", "an",
    "and", "any", "are", "aren't", "as", "at", "be", "because", "been",
    "before", "being", "below", "between", "both", "but", "by", "can",
    "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
    "doesn't", "doing", "don't", "down", "during", "each", "few", "for",
    "from", "further", "get", "got", "had", "hadn't", "has", "hasn't",
    "have", "haven't", "having", "he", "her", "here", "hers", "herself",
    "him", "himself", "his", "how", "i", "if", "in", "into", "is", "isn't",
    "it", "its", "itself", "just", "let", "me", "might", "more", "most",
    "must", "my", "myself", "no", "nor", "not", "now", "of", "off", "on",
    "once", "only", "or", "other", "our", "ours", "ourselves", "out",
    "over", "own", "re", "s", "same", "shall", "she", "should", "shouldn't",
    "so", "some", "such", "t", "than", "that", "the", "their", "theirs",
    "them", "themselves", "then", "there", "these", "they", "this", "those",
    "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
    "we", "were", "weren't", "what", "when", "where", "which", "while",
    "who", "whom", "why", "will", "with", "won't", "would", "wouldn't",
    "you", "your", "yours", "yourself", "yourselves",
})

# Simple suffix-stripping stemmer (Porter-lite) — handles common English suffixes
_SUFFIX_RULES = [
    (r"ies$", "i"),      # companies -> compani
    (r"ied$", "i"),      # applied -> appli  
    (r"sses$", "ss"),    # addresses -> address
    (r"ness$", ""),      # happiness -> happi
    (r"ments$", "ment"), # requirements -> requirement
    (r"tion$", "t"),     # validation -> validat
    (r"sion$", "s"),     # permission -> permiss
    (r"ling$", "l"),     # handling -> handl
    (r"ting$", "t"),     # computing -> comput
    (r"ning$", "n"),     # running -> runn
    (r"ing$", ""),       # coding -> cod
    (r"ment$", ""),      # assignment -> assign
    (r"ence$", ""),      # experience -> experi
    (r"ance$", ""),      # performance -> perform
    (r"able$", ""),      # readable -> read
    (r"ible$", ""),      # accessible -> access
    (r"ful$", ""),       # powerful -> power
    (r"less$", ""),      # careless -> care
    (r"ness$", ""),      # awareness -> aware
    (r"ous$", ""),       # dangerous -> danger
    (r"ive$", ""),       # creative -> creat
    (r"ly$", ""),        # quickly -> quick
    (r"er$", ""),        # faster -> fast
    (r"est$", ""),       # fastest -> fast
    (r"ed$", ""),        # played -> play
    (r"es$", ""),        # processes -> process
    (r"s$", ""),         # books -> book
]

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)


def _stem(word: str) -> str:
    """Lightweight suffix-stripping stemmer."""
    if len(word) <= 3:
        return word
    for pattern, replacement in _SUFFIX_RULES:
        stemmed = re.sub(pattern, replacement, word)
        if stemmed != word and len(stemmed) >= 3:
            return stemmed
    return word


def _tokenize(text: str) -> list[str]:
    """Tokenize with punctuation stripping, lowercasing, stopword removal, and stemming."""
    # Remove punctuation, lowercase, split on whitespace
    cleaned = _PUNCT_RE.sub(" ", text.lower())
    tokens = cleaned.split()
    # Filter stopwords and stem
    return [_stem(t) for t in tokens if t not in _STOPWORDS and len(t) >= 2]


# ── Fix #6: BM25 Index Cache ─────────────────────────────────────────────
# Cache the BM25 index per user to avoid rebuilding on every query.
# Invalidated when document count changes (new ingestion).

_bm25_cache: dict[str, dict] = {}  # user_id -> {count, bm25, docs, metadatas}


def invalidate_bm25_cache(user_id: str = None):
    """Call after ingesting new documents to clear stale cache."""
    if user_id:
        _bm25_cache.pop(user_id, None)
    else:
        _bm25_cache.clear()


def _get_or_build_bm25(user_id: str):
    """Return cached BM25 index for user, rebuilding only if docs changed."""
    collection = _get_docs_collection()
    result = collection.get(where={"user_id": user_id})

    docs = result.get("documents", [])
    metadatas = result.get("metadatas", [])

    if not docs:
        return None, [], []

    doc_count = len(docs)

    # Check cache validity
    cached = _bm25_cache.get(user_id)
    if cached and cached["count"] == doc_count:
        return cached["bm25"], cached["docs"], cached["metadatas"]

    # Rebuild index
    tokenized_corpus = [_tokenize(doc) for doc in docs]
    bm25 = BM25Okapi(tokenized_corpus)

    _bm25_cache[user_id] = {
        "count": doc_count,
        "bm25": bm25,
        "docs": docs,
        "metadatas": metadatas,
    }
    return bm25, docs, metadatas


def bm25_search(user_id: str, query: str, k: int = 4) -> list[dict]:
    """
    BM25 keyword search with stemming, stopword removal, and index caching.
    """
    bm25, docs, metadatas = _get_or_build_bm25(user_id)

    if bm25 is None:
        return []

    scores = bm25.get_scores(_tokenize(query))
    ranked_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]

    return [
        {
            "text": docs[i],
            "filename": metadatas[i].get("filename", "unknown file"),
            "bm25_score": float(scores[i]),
        }
        for i in ranked_indices
    ]