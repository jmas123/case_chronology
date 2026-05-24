"""Thin SQL helpers. Plain functions, one per concern.

Routers translate exceptions to HTTP responses. These helpers raise on
violation and assume the caller has already validated inputs.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.db import transaction
from app.schemas import (
    DatePrecision,
    Document,
    DocumentSummary,
    DocumentType,
    Event,
    Party,
    PartyRole,
    Source,
)


def insert_document(
    *,
    document_id: str,
    filename: str,
    type: DocumentType,
    raw_text: str,
    page_count: int,
) -> Document:
    uploaded_at = datetime.now(timezone.utc)
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO documents (id, filename, type, uploaded_at, raw_text, page_count)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (document_id, filename, type.value, uploaded_at.isoformat(), raw_text, page_count),
        )
    return Document(
        id=document_id,
        filename=filename,
        type=type,
        uploaded_at=uploaded_at,
        raw_text=raw_text,
        page_count=page_count,
    )


def list_documents() -> list[DocumentSummary]:
    with transaction() as conn:
        rows = conn.execute(
            "SELECT id, filename, type, uploaded_at, page_count FROM documents ORDER BY uploaded_at DESC"
        ).fetchall()
    return [
        DocumentSummary(
            id=row["id"],
            filename=row["filename"],
            type=DocumentType(row["type"]),
            uploaded_at=datetime.fromisoformat(row["uploaded_at"]),
            page_count=row["page_count"],
        )
        for row in rows
    ]


def get_document(document_id: str) -> Document | None:
    with transaction() as conn:
        row = conn.execute(
            "SELECT id, filename, type, uploaded_at, raw_text, page_count "
            "FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
    if row is None:
        return None
    return Document(
        id=row["id"],
        filename=row["filename"],
        type=DocumentType(row["type"]),
        uploaded_at=datetime.fromisoformat(row["uploaded_at"]),
        raw_text=row["raw_text"],
        page_count=row["page_count"],
    )


# --- Party dedup ---------------------------------------------------------

_NORMALIZE_STRIP = re.compile(r"[^\w\s]")
_LEGAL_SUFFIXES = {
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "co",
    "corp",
    "corporation",
    "company",
    "plc",
    "lp",
    "llp",
    "pllc",
}


def _normalize_name(name: str) -> str:
    """Lower, strip punctuation, drop trailing legal suffixes, collapse spaces."""
    cleaned = _NORMALIZE_STRIP.sub(" ", name.lower())
    tokens = [t for t in cleaned.split() if t]
    while tokens and tokens[-1] in _LEGAL_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def find_or_create_party(name: str, *, role: PartyRole = PartyRole.UNKNOWN) -> str:
    """Return the id of an existing party matching this name (by normalized name
    or any alias), or create a new one. New alternative spellings are appended
    to the matched party's aliases for future dedup."""
    normalized = _normalize_name(name)
    if not normalized:
        # Fall back: insert as-is with an empty normalized form to avoid silent merges.
        normalized = name.strip().lower()

    with transaction() as conn:
        rows = conn.execute(
            "SELECT id, name, aliases FROM parties"
        ).fetchall()
        for row in rows:
            existing_norm = _normalize_name(row["name"])
            if existing_norm == normalized:
                _maybe_add_alias(conn, row, name)
                return row["id"]
            aliases = json.loads(row["aliases"]) if row["aliases"] else []
            if any(_normalize_name(a) == normalized for a in aliases):
                _maybe_add_alias(conn, row, name)
                return row["id"]

        new_id = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO parties (id, name, role, aliases) VALUES (?, ?, ?, ?)",
            (new_id, name.strip(), role.value, json.dumps([])),
        )
        return new_id


def _maybe_add_alias(conn, row, incoming_name: str) -> None:
    aliases = json.loads(row["aliases"]) if row["aliases"] else []
    canonical = row["name"]
    if incoming_name == canonical or incoming_name in aliases:
        return
    aliases.append(incoming_name)
    conn.execute(
        "UPDATE parties SET aliases = ? WHERE id = ?",
        (json.dumps(aliases), row["id"]),
    )


# --- Event persistence ---------------------------------------------------

@dataclass
class PersistedSource:
    page: int
    char_start: int
    char_end: int
    quote: str


@dataclass
class PersistedEventParty:
    name: str
    role_in_event: str


@dataclass
class PersistedEventInput:
    date: str
    date_precision: str
    title: str
    description: str
    event_type: str
    confidence: float
    confidence_rationale: str
    sources: list[PersistedSource]
    parties: list[PersistedEventParty]


def insert_event_with_sources(
    *,
    document_id: str,
    event: PersistedEventInput,
) -> str:
    """Insert an Event plus its Sources and EventParty rows in one transaction.

    Raises ValueError if event.sources is empty. The whole insert is wrapped
    in a transaction, so a partial failure rolls back the event too. This is
    the persistence-layer half of the verifiability rule.
    """
    if not event.sources:
        raise ValueError("Refusing to insert event with no sources.")

    event_id = uuid.uuid4().hex
    party_ids = [find_or_create_party(p.name) for p in event.parties]

    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO events (id, date, date_precision, title, description,
                                event_type, confidence, confidence_rationale)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                event.date,
                event.date_precision,
                event.title,
                event.description,
                event.event_type,
                event.confidence,
                event.confidence_rationale,
            ),
        )
        for src in event.sources:
            conn.execute(
                """
                INSERT INTO sources (id, event_id, document_id, page,
                                     char_start, char_end, quote)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    uuid.uuid4().hex,
                    event_id,
                    document_id,
                    src.page,
                    src.char_start,
                    src.char_end,
                    src.quote,
                ),
            )
        for party_id, party in zip(party_ids, event.parties):
            conn.execute(
                """
                INSERT OR IGNORE INTO event_parties (event_id, party_id, role_in_event)
                VALUES (?, ?, ?)
                """,
                (event_id, party_id, party.role_in_event),
            )
    return event_id


def count_events_for_document(document_id: str) -> int:
    with transaction() as conn:
        row = conn.execute(
            "SELECT COUNT(DISTINCT e.id) AS n FROM events e "
            "JOIN sources s ON s.event_id = e.id WHERE s.document_id = ?",
            (document_id,),
        ).fetchone()
    return row["n"] if row else 0


# --- Event listing for the timeline --------------------------------------

# Cap chosen to keep the timeline payload bounded in v1. A real complaint
# rarely produces more than ~200 events; 500 leaves slack. When this becomes
# a real limit, swap for cursor pagination — the schema already orders by date.
EVENT_LIST_CAP = 500


def list_events(limit: int = EVENT_LIST_CAP) -> list[Event]:
    """Return events with sources + parties hydrated, ordered by date asc.

    Defensively drops events with zero sources (the verifiability guarantee's
    API-layer guard). The schema requires at least one source per event, so
    an orphan only occurs if the DB was tampered with directly.
    """
    with transaction() as conn:
        event_rows = conn.execute(
            "SELECT id, date, date_precision, title, description, event_type, "
            "       confidence, confidence_rationale "
            "FROM events ORDER BY date ASC, id ASC LIMIT ?",
            (limit,),
        ).fetchall()
        if not event_rows:
            return []
        event_ids = [row["id"] for row in event_rows]
        placeholders = ",".join("?" * len(event_ids))

        source_rows = conn.execute(
            f"SELECT id, event_id, document_id, page, char_start, char_end, quote "
            f"FROM sources WHERE event_id IN ({placeholders})",
            event_ids,
        ).fetchall()

        party_rows = conn.execute(
            f"SELECT ep.event_id, p.id, p.name, p.role, p.aliases, ep.role_in_event "
            f"FROM event_parties ep "
            f"JOIN parties p ON p.id = ep.party_id "
            f"WHERE ep.event_id IN ({placeholders})",
            event_ids,
        ).fetchall()

    sources_by_event: dict[str, list[Source]] = {}
    for row in source_rows:
        sources_by_event.setdefault(row["event_id"], []).append(
            Source(
                id=row["id"],
                event_id=row["event_id"],
                document_id=row["document_id"],
                page=row["page"],
                char_start=row["char_start"],
                char_end=row["char_end"],
                quote=row["quote"],
            )
        )

    parties_by_event: dict[str, list[Party]] = {}
    for row in party_rows:
        aliases = json.loads(row["aliases"]) if row["aliases"] else []
        parties_by_event.setdefault(row["event_id"], []).append(
            Party(
                id=row["id"],
                name=row["name"],
                role=PartyRole(row["role"]),
                aliases=aliases,
                role_in_event=row["role_in_event"],
            )
        )

    events: list[Event] = []
    for row in event_rows:
        sources = sources_by_event.get(row["id"], [])
        if not sources:
            # Verifiability rule: never surface a sourceless event.
            continue
        events.append(
            Event(
                id=row["id"],
                date=row["date"],
                date_precision=DatePrecision(row["date_precision"]),
                title=row["title"],
                description=row["description"],
                event_type=row["event_type"],
                confidence=row["confidence"],
                confidence_rationale=row["confidence_rationale"],
                sources=sources,
                parties=parties_by_event.get(row["id"], []),
            )
        )
    return events
