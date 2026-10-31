import sqlite3
import os
from contextlib import contextmanager
from datetime import datetime
 
SQLITE_PATH = os.getenv("SQLITE_PATH", "./db/agent.db")
 
 
def init_db():
    os.makedirs(os.path.dirname(SQLITE_PATH) or ".", exist_ok=True)
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,             -- 'user' | 'assistant'
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
                      CREATE TABLE IF NOT EXISTS files (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      user_id TEXT NOT NULL,
                      filename TEXT NOT NULL,
                      filepath TEXT NOT NULL,
                      filetype TEXT NOT NULL,
                      uploaded_at TEXT NOT NULL,
                      summary TEXT,
                      mermaid_diagram TEXT
                      )
        """)
        for column, coltype in [("summary", "TEXT"), ("mermaid_diagram", "TEXT")]:
                try:
                       conn.execute(f"ALTER TABLE files ADD COLUMN {column} {coltype}")
                except sqlite3.OperationalError:
                    pass
        conn.commit()
 
 
@contextmanager
def get_conn():
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
 
 
def save_message(user_id: str, session_id: str, role: str, content: str):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO messages (user_id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, session_id, role, content, datetime.utcnow().isoformat()),
        )
        conn.commit()
 
 
def get_recent_messages(user_id: str, session_id: str, limit: int = 20):
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT role, content FROM messages
               WHERE user_id = ? AND session_id = ?
               ORDER BY id DESC LIMIT ?""",
            (user_id, session_id, limit),
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
 
 
def save_file_record(user_id: str, filename: str, filepath: str, filetype: str,
                      summary: str = None, mermaid_diagram: str = None):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO files (user_id, filename, filepath, filetype, uploaded_at, summary, mermaid_diagram)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, filename, filepath, filetype, datetime.utcnow().isoformat(), summary, mermaid_diagram),
        )
        conn.commit()


def get_file_records(user_id: str):
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT filename, filetype, uploaded_at, summary, mermaid_diagram
               FROM files WHERE user_id = ? ORDER BY id DESC""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]