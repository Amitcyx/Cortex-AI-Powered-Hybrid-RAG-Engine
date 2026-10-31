import os
import re
from pypdf import PdfReader
 
CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".java", ".go", ".rs", ".cpp", ".c",
    ".rb", ".php", ".html", ".css", ".json", ".yaml", ".yml", ".md",
    ".txt", ".csv", ".tsv", ".sql", ".xml", ".log", ".rst", ".sh", ".bat"
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"}
 
 
def classify_file(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return "pdf"
    if ext in CODE_EXTENSIONS:
        return "code"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in AUDIO_EXTENSIONS:
        return "audio"
    return "other"
 
 
def load_pdf_pages_with_progress(filepath: str, progress_callback=None) -> list[dict]:
    """
    Extracts text page-by-page from a PDF, supporting large PDFs (2000-3000+ pages)
    with memory-efficient batching and progress reporting.
    Returns: [{"page": page_num, "text": page_text}, ...]
    """
    reader = PdfReader(filepath)
    total_pages = len(reader.pages)
    page_data = []

    # Report progress every 1% of pages (or at least every 5 pages)
    step = max(1, total_pages // 100)
    for idx, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        text = text.strip()
        if text:
            page_data.append({"page": idx + 1, "text": text})

        current = idx + 1
        if progress_callback and (current % step == 0 or current == total_pages):
            progress_callback(current, total_pages)

    return page_data


def load_pdf_text(filepath: str) -> str:
    pages = load_pdf_pages_with_progress(filepath)
    return "\n\n".join(p["text"] for p in pages)


def load_code_text(filepath: str) -> str:
    with open(filepath, "r", errors="ignore") as f:
        return f.read()


def load_text(filepath: str, filetype: str) -> str:
    if filetype == "pdf":
        return load_pdf_text(filepath)
    if filetype == "code":
        return load_code_text(filepath)
    return ""
 

# ── Sentence-Aware Chunking (Fix #2) ─────────────────────────────────────
# Split on sentence boundaries first, then merge sentences into chunks
# of ~target_size characters. Never splits mid-sentence.

_SENTENCE_SPLIT_RE = re.compile(
    r"(?<=[.!?])\s+"       # split after sentence-ending punctuation + whitespace
    r"|(?<=\n)\s*\n+"      # or on paragraph breaks (double newline)
)


def _split_sentences(text: str) -> list[str]:
    """Split text into sentence-level segments."""
    parts = _SENTENCE_SPLIT_RE.split(text)
    return [p.strip() for p in parts if p.strip()]


def chunk_text(text: str, chunk_size: int = 500, overlap_sentences: int = 1) -> list[str]:
    """Sentence-aware chunking: merge sentences until ~chunk_size chars,
    then start a new chunk with overlap_sentences carried over for context."""
    sentences = _split_sentences(text)
    if not sentences:
        return []

    chunks = []
    current_sentences = []
    current_len = 0

    for sent in sentences:
        # If adding this sentence exceeds the budget and we have content, flush
        if current_len + len(sent) > chunk_size and current_sentences:
            chunks.append(" ".join(current_sentences))
            # Overlap: carry the last N sentences into the next chunk
            if overlap_sentences > 0:
                current_sentences = current_sentences[-overlap_sentences:]
                current_len = sum(len(s) for s in current_sentences)
            else:
                current_sentences = []
                current_len = 0

        current_sentences.append(sent)
        current_len += len(sent)

    # Flush remaining
    if current_sentences:
        chunks.append(" ".join(current_sentences))

    return [c for c in chunks if c.strip()]


def chunk_pages(page_data: list[dict], chunk_size: int = 500, overlap_sentences: int = 1) -> list[dict]:
    """
    Sentence-aware chunking preserving page numbers in metadata.
    Returns: [{"text": chunk_text, "page": page_num, "chunk_index": i}, ...]
    """
    all_chunks = []
    chunk_counter = 0

    for item in page_data:
        p_num = item["page"]
        p_text = item["text"]
        chunks = chunk_text(p_text, chunk_size=chunk_size, overlap_sentences=overlap_sentences)
        for c in chunks:
            all_chunks.append({
                "text": c,
                "page": p_num,
                "chunk_index": chunk_counter,
            })
            chunk_counter += 1

    return all_chunks
