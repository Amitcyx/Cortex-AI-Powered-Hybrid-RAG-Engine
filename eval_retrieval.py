"""
Retrieval Accuracy Evaluation Suite for Cortex AI
===================================================
Tests all retrieval methods against ground-truth QA pairs derived from
the actual documents, facts, and media memories stored in ChromaDB.

Metrics computed:
  - Recall@k:    fraction of ground-truth chunks found in top-k results
  - Precision@k: fraction of top-k results that are ground-truth relevant
  - MRR:         reciprocal rank of the first relevant result
  - NDCG@k:      normalized discounted cumulative gain

Methods tested:
  1. Vector-only  (ChromaDB cosine similarity via all-MiniLM-L6-v2)
  2. BM25-only    (rank_bm25 BM25Okapi lexical search)
  3. Hybrid RRF   (Reciprocal Rank Fusion of vector + BM25)
  4. Unified       (RRF + facts + media, min-max normalized)
"""

import os
import sys
import json
import math
import time
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()

# Suppress Chroma telemetry noise
try:
    import chromadb.telemetry.product.posthog as chroma_posthog
    chroma_posthog.Posthog.capture = lambda *args, **kwargs: None
except Exception:
    pass

from ingestion.embed import retrieve_relevant_chunks_scored
from ingestion.vlrag import bm25_search
from memory.long_term import get_relevant_facts_scored
from memory.media_memory import get_relevant_media_scored
from memory.unified import (
    get_unified_context,
    _normalize_distances,
    _fuse_document_results,
)
from db.chroma_client import get_collection


# ─── Ground-Truth QA Pairs ────────────────────────────────────────────────
# Each pair: (user_id, query, expected_file, expected_keywords_in_chunk)
# A retrieved chunk is "relevant" if it matches the expected_file AND
# contains at least one of the expected_keywords (substring match).

@dataclass
class QAPair:
    user_id: str
    query: str
    expected_file: str
    expected_keywords: list[str]  # any of these in the chunk = relevant
    source_type: str = "document"  # "document", "fact", or "media"

DOCUMENT_QA_PAIRS = [
    # ── WT LAB.pdf questions (user_default) ──
    QAPair(
        user_id="user_default",
        query="What university is the Web Technology Lab course from?",
        expected_file="WT LAB.pdf",
        expected_keywords=["Savitribai Phule Pune University", "310257"],
    ),
    QAPair(
        user_id="user_default",
        query="What are the course outcomes CO2 and CO3?",
        expected_file="WT LAB.pdf",
        expected_keywords=["client side and server side", "web technology languages"],
    ),
    QAPair(
        user_id="user_default",
        query="How should laboratory assignments be assessed?",
        expected_file="WT LAB.pdf",
        expected_keywords=["timely completion", "performance", "innovation", "punctuality"],
    ),
    QAPair(
        user_id="user_default",
        query="What should students do before coding the website?",
        expected_file="WT LAB.pdf",
        expected_keywords=["visit different websites", "Min. 5", "evaluation results"],
    ),
    QAPair(
        user_id="user_default",
        query="Design an XML document for employee information",
        expected_file="WT LAB.pdf",
        expected_keywords=["XML", "DTD", "XML Schema", "XSL"],
    ),
    QAPair(
        user_id="user_default",
        query="What is the ebookshop database table structure?",
        expected_file="WT LAB.pdf",
        expected_keywords=["ebookshop", "book_id", "book_title", "book_price", "servlet"],
    ),
    QAPair(
        user_id="user_default",
        query="What validations are needed for the struts login page?",
        expected_file="WT LAB.pdf",
        expected_keywords=["Validation for correct names", "mobile numbers", "email id", "struts"],
    ),
    QAPair(
        user_id="user_default",
        query="What is the mini project requirement?",
        expected_file="WT LAB.pdf",
        expected_keywords=["dynamic web application", "business functionality"],
    ),
    QAPair(
        user_id="user_default",
        query="How to display database content using servlet?",
        expected_file="WT LAB.pdf",
        expected_keywords=["servlet", "SQL select query", "display"],
    ),
    QAPair(
        user_id="user_default",
        query="What is the CO-PO mapping matrix?",
        expected_file="WT LAB.pdf",
        expected_keywords=["CO -PO Mapping", "PO1", "PO2"],
    ),

    # ── index.php questions (user_1) ──
    QAPair(
        user_id="user_1",
        query="How does the PHP session login work?",
        expected_file="index.php",
        expected_keywords=["session_start", "SESSION", "login"],
    ),
    QAPair(
        user_id="user_1",
        query="What is the user login form HTML structure?",
        expected_file="index.php",
        expected_keywords=["USER LOGIN FORM", "col-md"],
    ),
    QAPair(
        user_id="user_1",
        query="How does the carousel or slider section work?",
        expected_file="index.php",
        expected_keywords=["INDICATORS", "carousel", "ol class"],
    ),
    QAPair(
        user_id="user_1",
        query="What PHP includes are used in the page?",
        expected_file="index.php",
        expected_keywords=["include", "header.php", "config.php"],
    ),

    # ── test_doc.py questions (test_user) ──
    QAPair(
        user_id="test_user",
        query="What does the authenticate_user function do?",
        expected_file="test_doc.py",
        expected_keywords=["authenticate_user", "credentials", "password hash"],
    ),
    QAPair(
        user_id="test_user",
        query="How are email notifications sent?",
        expected_file="test_doc.py",
        expected_keywords=["send_email", "notifications"],
    ),
]

FACT_QA_PAIRS = [
    QAPair(
        user_id="user_1",
        query="What kind of website is the user building?",
        expected_file="",
        expected_keywords=["Amazon", "e-commerce"],
        source_type="fact",
    ),
    QAPair(
        user_id="user_1",
        query="What programming languages does the user prefer?",
        expected_file="",
        expected_keywords=["HTML", "CSS", "JavaScript"],
        source_type="fact",
    ),
    QAPair(
        user_id="user_1",
        query="What is the user's ongoing project goal?",
        expected_file="",
        expected_keywords=["frontend", "functionality"],
        source_type="fact",
    ),
]

MEDIA_QA_PAIRS = [
    QAPair(
        user_id="user_default",
        query="What is a multi-modal AI agent?",
        expected_file="",
        expected_keywords=["multi-modal", "AI agent"],
        source_type="media",
    ),
]


# ─── Metrics ──────────────────────────────────────────────────────────────

def is_relevant(result_text: str, qa: QAPair) -> bool:
    """Check if a retrieved chunk is relevant to the QA pair."""
    text_lower = result_text.lower()
    return any(kw.lower() in text_lower for kw in qa.expected_keywords)


def recall_at_k(results: list[dict], qa: QAPair, k: int = 6) -> float:
    """Fraction: did we find at least one relevant chunk in top-k?"""
    top_k = results[:k]
    found = any(is_relevant(r["text"], qa) for r in top_k)
    return 1.0 if found else 0.0


def precision_at_k(results: list[dict], qa: QAPair, k: int = 6) -> float:
    """Fraction of top-k results that are relevant."""
    top_k = results[:k]
    if not top_k:
        return 0.0
    relevant_count = sum(1 for r in top_k if is_relevant(r["text"], qa))
    return relevant_count / len(top_k)


def reciprocal_rank(results: list[dict], qa: QAPair) -> float:
    """1/rank of the first relevant result (0 if none found)."""
    for i, r in enumerate(results):
        if is_relevant(r["text"], qa):
            return 1.0 / (i + 1)
    return 0.0


def ndcg_at_k(results: list[dict], qa: QAPair, k: int = 6) -> float:
    """Normalized Discounted Cumulative Gain at k."""
    top_k = results[:k]
    dcg = 0.0
    for i, r in enumerate(top_k):
        rel = 1.0 if is_relevant(r["text"], qa) else 0.0
        dcg += rel / math.log2(i + 2)  # log2(rank+1), rank is 1-indexed

    # Ideal DCG: all relevant items at the top
    num_relevant = sum(1 for r in results if is_relevant(r["text"], qa))
    ideal_relevant = min(num_relevant, k)
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_relevant))

    return dcg / idcg if idcg > 0 else 0.0


# ─── Retrieval Method Wrappers ────────────────────────────────────────────

def retrieve_vector_only(user_id: str, query: str, k: int = 6) -> list[dict]:
    return retrieve_relevant_chunks_scored(user_id, query, k=k)


def retrieve_bm25_only(user_id: str, query: str, k: int = 6) -> list[dict]:
    results = bm25_search(user_id, query, k=k)
    # Normalize to same schema
    for r in results:
        r["source_type"] = "document"
        r["distance"] = -r.get("bm25_score", 0)  # Higher score = better, invert
    return results


def retrieve_hybrid_rrf(user_id: str, query: str, k: int = 6) -> list[dict]:
    vector_docs = retrieve_relevant_chunks_scored(user_id, query, k=k)
    keyword_docs = bm25_search(user_id, query, k=k)
    fused = _fuse_document_results(vector_docs, keyword_docs)[:k]
    return _normalize_distances(fused)


def retrieve_unified(user_id: str, query: str, k: int = 6) -> list[dict]:
    return get_unified_context(user_id, query, k=k)


def retrieve_facts(user_id: str, query: str, k: int = 6) -> list[dict]:
    return get_relevant_facts_scored(user_id, query, k=k)


def retrieve_media(user_id: str, query: str, k: int = 6) -> list[dict]:
    return get_relevant_media_scored(user_id, query, k=k)


# ─── Evaluation Runner ───────────────────────────────────────────────────

@dataclass
class MethodResult:
    name: str
    recall_scores: list[float] = field(default_factory=list)
    precision_scores: list[float] = field(default_factory=list)
    mrr_scores: list[float] = field(default_factory=list)
    ndcg_scores: list[float] = field(default_factory=list)
    latencies_ms: list[float] = field(default_factory=list)
    per_query: list[dict] = field(default_factory=list)

    def avg(self, scores):
        return sum(scores) / len(scores) if scores else 0.0


def run_evaluation():
    K = 6  # top-k for retrieval

    print("=" * 72)
    print("  CORTEX AI — RETRIEVAL ACCURACY EVALUATION")
    print("=" * 72)

    # ── Phase 1: Document Retrieval ──
    doc_methods = {
        "Vector Only (Cosine)": retrieve_vector_only,
        "BM25 Only (Lexical)": retrieve_bm25_only,
        "Hybrid RRF (Vector+BM25)": retrieve_hybrid_rrf,
        "Unified (RRF+Facts+Media)": retrieve_unified,
    }

    doc_results: dict[str, MethodResult] = {
        name: MethodResult(name=name) for name in doc_methods
    }

    print(f"\n{'─' * 72}")
    print(f"  PHASE 1: DOCUMENT RETRIEVAL ({len(DOCUMENT_QA_PAIRS)} queries, k={K})")
    print(f"{'─' * 72}")

    for qi, qa in enumerate(DOCUMENT_QA_PAIRS):
        print(f"\n  Q{qi+1}: \"{qa.query}\"")
        print(f"       User: {qa.user_id} | Expected File: {qa.expected_file}")
        print(f"       Keywords: {qa.expected_keywords[:3]}...")

        for method_name, method_fn in doc_methods.items():
            t0 = time.perf_counter()
            try:
                results = method_fn(qa.user_id, qa.query, k=K)
            except Exception as e:
                print(f"       ⚠ {method_name}: ERROR - {e}")
                results = []
            elapsed_ms = (time.perf_counter() - t0) * 1000

            r = recall_at_k(results, qa, K)
            p = precision_at_k(results, qa, K)
            m = reciprocal_rank(results, qa)
            n = ndcg_at_k(results, qa, K)

            mr = doc_results[method_name]
            mr.recall_scores.append(r)
            mr.precision_scores.append(p)
            mr.mrr_scores.append(m)
            mr.ndcg_scores.append(n)
            mr.latencies_ms.append(elapsed_ms)

            hit = "✓" if r > 0 else "✗"
            mr.per_query.append({
                "query": qa.query,
                "hit": r > 0,
                "recall": r,
                "precision": p,
                "mrr": m,
                "ndcg": n,
                "latency_ms": elapsed_ms,
                "top_result": results[0]["text"][:80] if results else "(empty)",
            })
            print(f"       {hit} {method_name:30s} | R@{K}={r:.2f} P@{K}={p:.2f} MRR={m:.2f} NDCG={n:.2f} | {elapsed_ms:.0f}ms")

    # ── Phase 2: Fact Memory Retrieval ──
    fact_result = MethodResult(name="Fact Memory (Semantic)")

    print(f"\n{'─' * 72}")
    print(f"  PHASE 2: FACT MEMORY RETRIEVAL ({len(FACT_QA_PAIRS)} queries, k={K})")
    print(f"{'─' * 72}")

    for qi, qa in enumerate(FACT_QA_PAIRS):
        print(f"\n  Q{qi+1}: \"{qa.query}\"")
        t0 = time.perf_counter()
        results = retrieve_facts(qa.user_id, qa.query, k=K)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        r = recall_at_k(results, qa, K)
        p = precision_at_k(results, qa, K)
        m = reciprocal_rank(results, qa)
        n = ndcg_at_k(results, qa, K)

        fact_result.recall_scores.append(r)
        fact_result.precision_scores.append(p)
        fact_result.mrr_scores.append(m)
        fact_result.ndcg_scores.append(n)
        fact_result.latencies_ms.append(elapsed_ms)

        hit = "✓" if r > 0 else "✗"
        print(f"       {hit} R@{K}={r:.2f} P@{K}={p:.2f} MRR={m:.2f} NDCG={n:.2f} | {elapsed_ms:.0f}ms")
        if results:
            print(f"         Top result: {results[0]['text'][:100]}...")

    # ── Phase 3: Media Memory Retrieval ──
    media_result = MethodResult(name="Media Memory (Semantic)")

    print(f"\n{'─' * 72}")
    print(f"  PHASE 3: MEDIA MEMORY RETRIEVAL ({len(MEDIA_QA_PAIRS)} queries, k={K})")
    print(f"{'─' * 72}")

    for qi, qa in enumerate(MEDIA_QA_PAIRS):
        print(f"\n  Q{qi+1}: \"{qa.query}\"")
        t0 = time.perf_counter()
        results = retrieve_media(qa.user_id, qa.query, k=K)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        r = recall_at_k(results, qa, K)
        p = precision_at_k(results, qa, K)
        m = reciprocal_rank(results, qa)
        n = ndcg_at_k(results, qa, K)

        media_result.recall_scores.append(r)
        media_result.precision_scores.append(p)
        media_result.mrr_scores.append(m)
        media_result.ndcg_scores.append(n)
        media_result.latencies_ms.append(elapsed_ms)

        hit = "✓" if r > 0 else "✗"
        print(f"       {hit} R@{K}={r:.2f} P@{K}={p:.2f} MRR={m:.2f} NDCG={n:.2f} | {elapsed_ms:.0f}ms")
        if results:
            print(f"         Top result: {results[0]['text'][:100]}...")

    # ─── Summary Report ──────────────────────────────────────────────────
    print(f"\n{'=' * 72}")
    print(f"  FINAL RETRIEVAL ACCURACY REPORT")
    print(f"{'=' * 72}")

    print(f"\n  ┌─{'─'*32}─┬─{'─'*8}─┬─{'─'*8}─┬─{'─'*8}─┬─{'─'*8}─┬─{'─'*8}─┐")
    print(f"  │ {'Method':32s} │ {'R@6':8s} │ {'P@6':8s} │ {'MRR':8s} │ {'NDCG@6':8s} │ {'Lat(ms)':8s} │")
    print(f"  ├─{'─'*32}─┼─{'─'*8}─┼─{'─'*8}─┼─{'─'*8}─┼─{'─'*8}─┼─{'─'*8}─┤")

    all_methods = list(doc_results.values()) + [fact_result, media_result]
    for mr in all_methods:
        if not mr.recall_scores:
            continue
        r = mr.avg(mr.recall_scores)
        p = mr.avg(mr.precision_scores)
        m = mr.avg(mr.mrr_scores)
        n = mr.avg(mr.ndcg_scores)
        lat = mr.avg(mr.latencies_ms)
        print(f"  │ {mr.name:32s} │ {r:7.1%} │ {p:7.1%} │ {m:7.3f} │ {n:7.3f} │ {lat:7.1f} │")

    print(f"  └─{'─'*32}─┴─{'─'*8}─┴─{'─'*8}─┴─{'─'*8}─┴─{'─'*8}─┴─{'─'*8}─┘")

    # Per-query failure analysis
    print(f"\n  MISS ANALYSIS (queries with Recall@{K} = 0):")
    print(f"  {'─' * 68}")
    any_misses = False
    for method_name, mr in doc_results.items():
        misses = [pq for pq in mr.per_query if not pq["hit"]]
        if misses:
            any_misses = True
            print(f"\n  {method_name}:")
            for miss in misses:
                print(f"    ✗ \"{miss['query'][:60]}\"")
                print(f"      Top result was: \"{miss['top_result'][:70]}...\"")

    if not any_misses:
        print("  None! All document queries had at least one relevant result.")

    # Save detailed JSON report
    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "k": K,
        "document_queries": len(DOCUMENT_QA_PAIRS),
        "fact_queries": len(FACT_QA_PAIRS),
        "media_queries": len(MEDIA_QA_PAIRS),
        "results": {},
    }
    for mr in all_methods:
        if not mr.recall_scores:
            continue
        report["results"][mr.name] = {
            "recall_at_k": round(mr.avg(mr.recall_scores), 4),
            "precision_at_k": round(mr.avg(mr.precision_scores), 4),
            "mrr": round(mr.avg(mr.mrr_scores), 4),
            "ndcg_at_k": round(mr.avg(mr.ndcg_scores), 4),
            "avg_latency_ms": round(mr.avg(mr.latencies_ms), 1),
            "per_query": mr.per_query,
        }

    report_path = os.path.join(os.path.dirname(__file__), "eval_retrieval_report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n  Detailed JSON report saved to: {report_path}")
    print(f"{'=' * 72}\n")


if __name__ == "__main__":
    run_evaluation()
