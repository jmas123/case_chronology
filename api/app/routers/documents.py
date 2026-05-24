"""Document upload and listing.

POST /documents       multipart upload, validates ext, extracts text, persists
GET  /documents       returns DocumentSummary list, newest first
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.agent.extractor import extract_events
from app.extractors import extract
from app.repo import (
    PersistedEventInput,
    PersistedEventParty,
    PersistedSource,
    count_events_for_document,
    get_document,
    insert_document,
    insert_event_with_sources,
    list_documents,
)
from app.schemas import (
    Document,
    DocumentSummary,
    DocumentType,
    ExtractResponse,
    UploadDocumentResponse,
)

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

SUPPORTED_EXTS = {"pdf", "docx", "txt"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB. Generous for v1, revisit if a real complaint hits the cap.


def _ext_from_filename(filename: str) -> str:
    _, _, ext = filename.rpartition(".")
    return ext.lower()


@router.post("", response_model=UploadDocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile = File(...)) -> UploadDocumentResponse:
    filename = file.filename or ""
    ext = _ext_from_filename(filename)
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '.{ext}'. Supported: pdf, docx, txt.",
        )

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
        )

    document_id = uuid.uuid4().hex
    stored_path = UPLOAD_DIR / f"{document_id}.{ext}"
    stored_path.write_bytes(data)

    try:
        extracted = extract(stored_path, ext)
    except Exception as exc:
        # Extraction failure is a boundary concern. Clean up the file so we
        # don't accumulate orphans, then translate to a 422.
        stored_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to extract text: {exc}",
        ) from exc

    document = insert_document(
        document_id=document_id,
        filename=filename,
        type=DocumentType(ext),
        raw_text=extracted.raw_text,
        page_count=extracted.page_count,
    )

    summary = DocumentSummary(
        id=document.id,
        filename=document.filename,
        type=document.type,
        uploaded_at=document.uploaded_at,
        page_count=document.page_count,
    )
    return UploadDocumentResponse(document=summary, warning=extracted.warning)


@router.get("", response_model=list[DocumentSummary])
def list_all() -> list[DocumentSummary]:
    return list_documents()


@router.get("/{document_id}", response_model=Document)
def get_one(document_id: str) -> Document:
    document = get_document(document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


def get_anthropic_client():
    """FastAPI dependency for the Anthropic client.

    Overridden in tests via app.dependency_overrides to inject a fake.
    Default returns None so the extractor's lazy default kicks in.
    """
    return None


@router.post("/{document_id}/extract", response_model=ExtractResponse)
def extract_document(document_id: str, client=Depends(get_anthropic_client)) -> ExtractResponse:
    document = get_document(document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    try:
        result = extract_events(
            document_id=document.id,
            filename=document.filename,
            raw_text=document.raw_text,
            doc_type=document.type.value,
            client=client,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Extraction agent failed: {exc}",
        ) from exc

    persisted = 0
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
            persisted += 1
        except ValueError:
            # Source-less events are rejected at persistence per the
            # verifiability rule. They should not occur because the
            # extractor only emits events with verified sources, but
            # the persistence layer is the final guard.
            continue

    return ExtractResponse(
        document_id=document.id,
        events_persisted=persisted,
        rejected_bad_quote=result.rejected_bad_quote,
        prompt_version=result.prompt_version,
    )


# Convenience: list events for a document (used by tests and Phase 3).
@router.get("/{document_id}/events")
def list_document_events(document_id: str):
    if get_document(document_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    # Return a minimal payload for now; Phase 3 introduces a richer schema.
    return {"document_id": document_id, "event_count": count_events_for_document(document_id)}
