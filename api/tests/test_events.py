from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.db import transaction
from app.main import app
from app.repo import (
    PersistedEventInput,
    PersistedEventParty,
    PersistedSource,
    insert_document,
    insert_event_with_sources,
)
from app.schemas import DocumentType

client = TestClient(app)


def _doc(filename: str = "fixture.txt") -> str:
    return insert_document(
        document_id=uuid.uuid4().hex,
        filename=filename,
        type=DocumentType.TXT,
        raw_text="any text",
        page_count=1,
    ).id


def _event(doc_id: str, *, date: str, title: str) -> str:
    return insert_event_with_sources(
        document_id=doc_id,
        event=PersistedEventInput(
            date=date,
            date_precision="exact",
            title=title,
            description="x",
            event_type="filing",
            confidence=0.9,
            confidence_rationale="y",
            sources=[PersistedSource(page=1, char_start=0, char_end=4, quote="any!")],
            parties=[PersistedEventParty(name="Acme Corp.", role_in_event="filer")],
        ),
    )


def test_events_empty():
    response = client.get("/events")
    assert response.status_code == 200
    assert response.json() == []


def test_events_returns_hydrated_event_in_date_order():
    doc_id = _doc()
    _event(doc_id, date="2024-04-01", title="Second")
    _event(doc_id, date="2024-03-01", title="First")

    response = client.get("/events")
    assert response.status_code == 200
    events = response.json()
    assert [e["title"] for e in events] == ["First", "Second"]
    first = events[0]
    assert len(first["sources"]) == 1
    assert first["sources"][0]["quote"] == "any!"
    assert first["sources"][0]["document_id"] == doc_id
    assert len(first["parties"]) == 1
    assert first["parties"][0]["name"] == "Acme Corp."
    assert first["parties"][0]["role_in_event"] == "filer"


def test_events_drops_orphans_without_sources():
    """Defensive: even if a sourceless event lands in the DB, /events hides it."""
    doc_id = _doc()
    _event(doc_id, date="2024-05-01", title="With Source")

    # Manually insert an orphan event row directly, bypassing the helper.
    orphan_id = uuid.uuid4().hex
    with transaction() as conn:
        conn.execute(
            "INSERT INTO events (id, date, date_precision, title, description, "
            "event_type, confidence, confidence_rationale) "
            "VALUES (?, '2024-06-01', 'exact', 'Orphan', 'x', 'filing', 0.5, 'y')",
            (orphan_id,),
        )

    events = client.get("/events").json()
    titles = [e["title"] for e in events]
    assert "With Source" in titles
    assert "Orphan" not in titles
