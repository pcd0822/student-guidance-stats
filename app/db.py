"""SQLite 저장소 (data/app.db)."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional

from . import paths

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS uploads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_year INTEGER NOT NULL,
    grade       INTEGER NOT NULL,
    month       INTEGER NOT NULL,
    period_from TEXT,
    period_to   TEXT,
    file_name   TEXT,
    uploaded_at TEXT DEFAULT (datetime('now','localtime')),
    student_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS monthly_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_year INTEGER NOT NULL,
    grade       INTEGER NOT NULL,
    month       INTEGER NOT NULL,
    class       INTEGER,
    number      INTEGER,
    student_id  TEXT NOT NULL,
    name        TEXT,
    abs         INTEGER DEFAULT 0,
    late        INTEGER DEFAULT 0,
    leave       INTEGER DEFAULT 0,
    result      INTEGER DEFAULT 0,
    raw_json    TEXT,
    upload_id   INTEGER REFERENCES uploads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_records_key ON monthly_records(school_year, grade, month);
CREATE INDEX IF NOT EXISTS ix_records_student ON monthly_records(school_year, student_id);
CREATE TABLE IF NOT EXISTS exclusions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_year INTEGER NOT NULL,
    student_id  TEXT NOT NULL,
    name        TEXT,
    all_period  INTEGER DEFAULT 0,
    all_reason  TEXT,
    months      TEXT DEFAULT '{}',
    note        TEXT,
    updated_at  TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(school_year, student_id)
);
CREATE TABLE IF NOT EXISTS exclusion_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_year INTEGER NOT NULL,
    student_id  TEXT NOT NULL,
    month       INTEGER NOT NULL,
    item        TEXT NOT NULL,
    recorded    INTEGER NOT NULL,
    documented  INTEGER NOT NULL,
    kind        TEXT,
    reason      TEXT,
    became_target INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'open',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS guidance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_year INTEGER NOT NULL,
    student_id  TEXT NOT NULL,
    name        TEXT,
    grade       INTEGER,
    step        INTEGER,
    month       INTEGER,
    date        TEXT,
    measure     TEXT,
    meeting_id  INTEGER,
    note        TEXT,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_guidance_student ON guidance(school_year, student_id);
CREATE TABLE IF NOT EXISTS meetings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    school_year INTEGER NOT NULL,
    grade       INTEGER NOT NULL,
    seq         INTEGER,
    date        TEXT,
    time_range  TEXT,
    place       TEXT,
    chair       TEXT,
    members     TEXT,
    agenda      TEXT,
    payload     TEXT,
    status      TEXT DEFAULT 'draft',
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    updated_at  TEXT DEFAULT (datetime('now','localtime'))
);
"""

_init_lock = threading.Lock()
_initialized: Dict[str, bool] = {}


def connect() -> sqlite3.Connection:
    path = str(paths.db_path())
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    with _init_lock:
        if not _initialized.get(path):
            conn.execute("PRAGMA journal_mode = WAL")
            conn.executescript(SCHEMA)
            conn.commit()
            _initialized[path] = True
    return conn


def reset_init_cache() -> None:
    """복원·테스트에서 DB 파일을 바꾼 뒤 스키마를 다시 확인하게 한다."""
    with _init_lock:
        _initialized.clear()


@contextmanager
def session() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------- settings

def get_setting(conn: sqlite3.Connection, key: str, default: Any = None) -> Any:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, ValueError):
        return default


def set_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value, ensure_ascii=False)),
    )


def all_settings(conn: sqlite3.Connection) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for row in conn.execute("SELECT key, value FROM settings"):
        try:
            out[row["key"]] = json.loads(row["value"])
        except (TypeError, ValueError):
            out[row["key"]] = None
    return out


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    return dict(row) if row is not None else None
