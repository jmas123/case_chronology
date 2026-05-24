"""SQLite setup. Schema lives here so a Postgres swap is a contained change.

Run as a module:
    python -m app.db init    # create tables if missing
    python -m app.db reset   # drop and recreate
    python -m app.db seed    # seed stub, no-op until Phase 7
"""

from __future__ import annotations

import os
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.getenv("DATABASE_PATH", "case_chronology.db"))


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS documents (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('pdf', 'docx', 'txt')),
    uploaded_at  TEXT NOT NULL,
    raw_text     TEXT NOT NULL,
    page_count   INTEGER NOT NULL CHECK (page_count >= 0)
);

CREATE TABLE IF NOT EXISTS events (
    id                    TEXT PRIMARY KEY,
    date                  TEXT NOT NULL,
    date_precision        TEXT NOT NULL CHECK (date_precision IN ('exact', 'on_or_about', 'range', 'approximate')),
    title                 TEXT NOT NULL,
    description           TEXT NOT NULL,
    event_type            TEXT NOT NULL,
    confidence            REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    confidence_rationale  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    role     TEXT NOT NULL,
    aliases  TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sources (
    id           TEXT PRIMARY KEY,
    event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page         INTEGER NOT NULL CHECK (page >= 1),
    char_start   INTEGER NOT NULL CHECK (char_start >= 0),
    char_end     INTEGER NOT NULL CHECK (char_end >= 0),
    quote        TEXT NOT NULL CHECK (length(quote) > 0)
);

CREATE TABLE IF NOT EXISTS event_parties (
    event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    party_id       TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    role_in_event  TEXT NOT NULL,
    PRIMARY KEY (event_id, party_id)
);

CREATE INDEX IF NOT EXISTS idx_sources_event_id ON sources(event_id);
CREATE INDEX IF NOT EXISTS idx_sources_document_id ON sources(document_id);
CREATE INDEX IF NOT EXISTS idx_event_parties_event_id ON event_parties(event_id);
CREATE INDEX IF NOT EXISTS idx_event_parties_party_id ON event_parties(party_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def transaction():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init() -> None:
    """Create tables if they do not exist."""
    with transaction() as conn:
        conn.executescript(SCHEMA_SQL)
    print(f"Initialized schema at {DB_PATH.resolve()}")


def reset() -> None:
    """Drop the database file and recreate it from scratch."""
    if DB_PATH.exists():
        DB_PATH.unlink()
        print(f"Removed {DB_PATH.resolve()}")
    init()


def seed() -> None:
    """Seed stub. Real seed data lands in Phase 7."""
    print("Seed stub. Real seed data (synthetic complaint, deposition, medical record) lands in Phase 7.")


def main() -> None:
    commands = {"init": init, "reset": reset, "seed": seed}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print(f"Usage: python -m app.db [{' | '.join(commands)}]")
        sys.exit(1)
    commands[sys.argv[1]]()


if __name__ == "__main__":
    main()
