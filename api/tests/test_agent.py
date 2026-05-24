from __future__ import annotations

import io
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repo import (
    PersistedEventInput,
    PersistedEventParty,
    PersistedSource,
    find_or_create_party,
    insert_event_with_sources,
)
from app.routers.documents import get_anthropic_client


# --- Fake Anthropic client ----------------------------------------------


def _tool_use(name: str, input_: dict, id_: str = "toolu_test"):
    return SimpleNamespace(type="tool_use", name=name, input=input_, id=id_)


def _text(text: str):
    return SimpleNamespace(type="text", text=text)


class _FakeMessages:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self._responses:
            raise AssertionError("FakeMessages.create called more times than scripted")
        return SimpleNamespace(content=self._responses.pop(0))


class _FakeAnthropic:
    def __init__(self, responses):
        self.messages = _FakeMessages(responses)


# --- Fixtures ------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


def _upload_txt(client: TestClient, content: bytes, filename: str = "fixture.txt") -> str:
    response = client.post(
        "/documents", files={"file": (filename, io.BytesIO(content), "text/plain")}
    )
    assert response.status_code == 201, response.text
    return response.json()["document"]["id"]


# --- Tests ---------------------------------------------------------------


def test_persistence_rejects_event_without_sources():
    """The verifiability rule's persistence-layer guard."""
    with pytest.raises(ValueError):
        insert_event_with_sources(
            document_id="any",
            event=PersistedEventInput(
                date="2024-03-05",
                date_precision="exact",
                title="meeting",
                description="x",
                event_type="meeting",
                confidence=0.9,
                confidence_rationale="y",
                sources=[],
                parties=[],
            ),
        )


def test_party_dedup_normalizes_legal_suffixes_and_aliases():
    a = find_or_create_party("Acme Corp.")
    b = find_or_create_party("Acme Corporation")
    c = find_or_create_party("acme")
    assert a == b == c

    # Distinct name should not collide.
    d = find_or_create_party("Globex LLC")
    assert d != a


def test_extract_endpoint_persists_verbatim_event(client: TestClient):
    """End-to-end happy path with a mocked agent: one event, verbatim quote."""
    text = "On March 5, 2024, Acme Corp. filed the complaint against Globex."
    doc_id = _upload_txt(client, text.encode())

    quote = "On March 5, 2024, Acme Corp. filed the complaint against Globex."
    start = text.index(quote)
    end = start + len(quote)

    fake = _FakeAnthropic([
        [
            _tool_use("record_event", {
                "date": "2024-03-05",
                "date_precision": "exact",
                "title": "Complaint filed",
                "description": "Acme filed a complaint against Globex.",
                "event_type": "filing",
                "parties": [
                    {"name": "Acme Corp.", "role_in_event": "filer"},
                    {"name": "Globex", "role_in_event": "defendant"},
                ],
                "source_quote": quote,
                "source_page": 1,
                "source_char_start": start,
                "source_char_end": end,
                "confidence": 0.95,
                "confidence_rationale": "Explicit calendar date and named parties.",
            }, id_="toolu_1"),
        ],
        [
            _tool_use("finish", {"reason": "all_events_recorded"}, id_="toolu_2"),
        ],
    ])

    app.dependency_overrides[get_anthropic_client] = lambda: fake
    try:
        response = client.post(f"/documents/{doc_id}/extract")
    finally:
        app.dependency_overrides.pop(get_anthropic_client, None)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["events_persisted"] == 1
    assert body["rejected_bad_quote"] == 0
    assert body["prompt_version"]

    # Verify via the helper endpoint.
    listing = client.get(f"/documents/{doc_id}/events")
    assert listing.status_code == 200
    assert listing.json()["event_count"] == 1


def test_extract_rejects_quote_mismatch_then_finishes(client: TestClient):
    """Bad quote triggers a corrective turn; event is not persisted."""
    text = "Meeting occurred on March 5, 2024."
    doc_id = _upload_txt(client, text.encode())

    # First turn: model claims a quote that is NOT a substring at the offsets.
    bad_quote = "totally fabricated text"
    fake = _FakeAnthropic([
        [
            _tool_use("record_event", {
                "date": "2024-03-05",
                "date_precision": "exact",
                "title": "Meeting",
                "description": "A meeting.",
                "event_type": "meeting",
                "parties": [],
                "source_quote": bad_quote,
                "source_page": 1,
                "source_char_start": 0,
                "source_char_end": len(bad_quote),
                "confidence": 0.8,
                "confidence_rationale": "x",
            }, id_="toolu_bad"),
        ],
        # After correction, model gives up and finishes.
        [
            _tool_use("finish", {"reason": "no_verifiable_quote"}, id_="toolu_done"),
        ],
    ])

    app.dependency_overrides[get_anthropic_client] = lambda: fake
    try:
        response = client.post(f"/documents/{doc_id}/extract")
    finally:
        app.dependency_overrides.pop(get_anthropic_client, None)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["events_persisted"] == 0
    assert body["rejected_bad_quote"] == 1


def test_extract_returns_404_for_unknown_document(client: TestClient):
    response = client.post("/documents/does-not-exist/extract")
    assert response.status_code == 404
