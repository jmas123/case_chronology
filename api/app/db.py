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


def _ingest_samples() -> tuple[int, int, int]:
    """Ingest every sample-*.txt and run extraction. Does NOT touch existing
    rows. Returns (docs_seeded, events_persisted, events_rejected).
    Requires ANTHROPIC_API_KEY in the env; raises RuntimeError if missing.
    """
    import uuid

    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set; cannot run the extraction agent."
        )

    from app.agent.extractor import extract_events
    from app.extractors import extract
    from app.repo import (
        PersistedEventInput,
        PersistedEventParty,
        PersistedSource,
        insert_document,
        insert_event_with_sources,
    )
    from app.schemas import DocumentType

    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    if not samples_dir.is_dir():
        raise RuntimeError(f"Samples directory not found: {samples_dir}")

    sample_files = sorted(samples_dir.glob("sample-*.txt"))
    if not sample_files:
        raise RuntimeError(f"No sample-*.txt files in {samples_dir}")

    docs_seeded = 0
    events_persisted = 0
    events_rejected = 0
    for path in sample_files:
        print(f"  ingesting {path.name}...")
        extracted = extract(path, "txt")
        document = insert_document(
            document_id=uuid.uuid4().hex,
            filename=path.name,
            type=DocumentType.TXT,
            raw_text=extracted.raw_text,
            page_count=extracted.page_count,
        )
        docs_seeded += 1

        print(f"  extracting events from {path.name}...")
        result = extract_events(
            document_id=document.id,
            filename=document.filename,
            raw_text=document.raw_text,
            doc_type=document.type.value,
        )
        for event in result.events:
            try:
                insert_event_with_sources(
                    document_id=document.id,
                    event=PersistedEventInput(
                        date=event.date,
                        date_precision=event.date_precision,
                        title=event.title,
                        description=event.description,
                        event_type=event.event_type,
                        confidence=event.confidence,
                        confidence_rationale=event.confidence_rationale,
                        sources=[
                            PersistedSource(
                                page=event.source_page,
                                char_start=event.source_char_start,
                                char_end=event.source_char_end,
                                quote=event.source_quote,
                            )
                        ],
                        parties=[
                            PersistedEventParty(name=p.name, role_in_event=p.role_in_event)
                            for p in event.parties
                        ],
                    ),
                )
                events_persisted += 1
            except ValueError:
                events_rejected += 1
        events_rejected += result.rejected_bad_quote

    return docs_seeded, events_persisted, events_rejected


def seed() -> None:
    """Reset the DB and ingest every sample-*.txt with full extraction.
    Destructive: wipes the database first so the demo starts from a clean state.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        print(
            "ANTHROPIC_API_KEY is not set. The seed command runs the extraction "
            "agent against three sample documents and needs a real key. Set it "
            "in .env and re-run.",
            file=sys.stderr,
        )
        sys.exit(1)

    reset()
    docs, events, rejected = _ingest_samples()
    print(
        f"Seeded {docs} documents, extracted {events} events"
        + (f", rejected {rejected}." if rejected else ".")
    )


def auto_seed_if_empty() -> None:
    """Run sample ingestion only when the DB has zero documents.
    Safe to call repeatedly; no-ops once seeded. Used at server startup
    so a fresh persistent volume gets populated automatically.
    """
    conn = connect()
    try:
        count = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    finally:
        conn.close()
    if count > 0:
        return
    print("DB is empty; auto-seeding sample documents...")
    try:
        docs, events, rejected = _ingest_samples()
    except RuntimeError as e:
        print(f"Auto-seed skipped: {e}", file=sys.stderr)
        return
    print(
        f"Auto-seed complete: {docs} documents, {events} events"
        + (f", {rejected} rejected." if rejected else ".")
    )


def main() -> None:
    commands = {"init": init, "reset": reset, "seed": seed}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print(f"Usage: python -m app.db [{' | '.join(commands)}]")
        sys.exit(1)
    commands[sys.argv[1]]()


if __name__ == "__main__":
    main()
