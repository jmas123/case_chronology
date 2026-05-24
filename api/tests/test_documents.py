from __future__ import annotations

import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _upload(filename: str, content: bytes, content_type: str = "text/plain"):
    return client.post(
        "/documents",
        files={"file": (filename, io.BytesIO(content), content_type)},
    )


def test_upload_txt_persists_and_lists():
    response = _upload("complaint.txt", b"On March 5, 2024, the parties met.")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["warning"] is None
    doc = body["document"]
    assert doc["filename"] == "complaint.txt"
    assert doc["type"] == "txt"
    assert doc["page_count"] == 1

    listing = client.get("/documents")
    assert listing.status_code == 200
    items = listing.json()
    assert len(items) == 1
    assert items[0]["id"] == doc["id"]


def test_upload_unsupported_extension_returns_415():
    response = _upload("notes.rtf", b"some content", "application/rtf")
    assert response.status_code == 415
    assert "Unsupported file type" in response.json()["detail"]


def test_upload_empty_file_returns_400():
    response = _upload("empty.txt", b"")
    assert response.status_code == 400


def test_scanned_pdf_surfaces_warning(monkeypatch):
    """A PDF whose pages yield no text triggers the scanned-document warning."""

    class _FakePage:
        def extract_text(self):
            return ""

    class _FakeReader:
        def __init__(self, *_args, **_kwargs):
            self.pages = [_FakePage(), _FakePage()]

    monkeypatch.setattr("app.extractors.PdfReader", _FakeReader)

    response = _upload("scanned.pdf", b"%PDF-1.4 fake bytes", "application/pdf")
    assert response.status_code == 201
    body = response.json()
    assert body["warning"] is not None
    assert "scanned" in body["warning"].lower()
    assert body["document"]["page_count"] == 2


def test_list_documents_empty_when_no_uploads():
    response = client.get("/documents")
    assert response.status_code == 200
    assert response.json() == []


def test_upload_missing_extension_returns_415():
    response = _upload("noext", b"content")
    assert response.status_code == 415
