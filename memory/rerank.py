import numpy as np
from sentence_transformers import CrossEncoder

_reranker_model = None

def get_reranker() -> CrossEncoder:
    """Lazy-load the CrossEncoder singleton."""
    global _reranker_model
    if _reranker_model is None:
        _reranker_model = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
    return _reranker_model


def rerank_and_filter(query: str, items: list[dict], top_k: int = 6, min_score: float = -6.0) -> list[dict]:
    """
    Re-scores candidates using MS-MARCO CrossEncoder.
    - query: user question/prompt
    - items: candidate chunks retrieved by first-stage retrieval (Vector/BM25/Facts/Media)
    - top_k: maximum number of items to return
    - min_score: threshold cutoff to filter out completely irrelevant noise
    """
    if not items:
        return []

    model = get_reranker()
    pairs = [(query, item["text"]) for item in items]
    scores = model.predict(pairs)

    scored_items = []
    for item, raw_score in zip(items, scores):
        score_val = float(raw_score)
        # Calculate approximate sigmoid probability
        prob = float(1 / (1 + np.exp(-score_val)))
        
        item_copy = dict(item)
        item_copy["rerank_score"] = score_val
        item_copy["relevance_prob"] = prob
        scored_items.append(item_copy)

    # Sort descending by cross-encoder score (higher score = more relevant)
    scored_items.sort(key=lambda x: x["rerank_score"], reverse=True)

    # Dynamic cutoff filtering:
    # 1. Filter out items below min_score (-6.0 represents < 0.002 probability / pure noise)
    # 2. Always keep at least the top-1 item if its score is reasonable (> -9.0)
    filtered = [it for it in scored_items if it["rerank_score"] >= min_score]
    if not filtered and scored_items and scored_items[0]["rerank_score"] > -9.0:
        filtered = [scored_items[0]]

    return filtered[:top_k]
