"""Pydantic v2 models. Source of truth for all data shapes.

The TypeScript types in shared/types.ts mirror this file. When a model
changes here, update shared/types.ts in the same change.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DatePrecision(str, Enum):
    EXACT = "exact"
    ON_OR_ABOUT = "on_or_about"
    RANGE = "range"
    APPROXIMATE = "approximate"


class DocumentType(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    TXT = "txt"


class PartyRole(str, Enum):
    PLAINTIFF = "plaintiff"
    DEFENDANT = "defendant"
    WITNESS = "witness"
    COUNSEL = "counsel"
    THIRD_PARTY = "third_party"
    UNKNOWN = "unknown"


class Document(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    type: DocumentType
    uploaded_at: datetime
    raw_text: str
    page_count: int = Field(ge=0)


class DocumentSummary(BaseModel):
    """Lightweight Document view for list endpoints. No raw_text."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    type: DocumentType
    uploaded_at: datetime
    page_count: int


class Party(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    role: PartyRole
    aliases: list[str] = Field(default_factory=list)
    # Populated when this Party is returned in an Event context (i.e. via
    # GET /events). The party's role *for this particular event*, e.g.
    # "filer", "recipient". None in standalone party listings.
    role_in_event: str | None = None


class Source(BaseModel):
    """A verbatim citation tying an Event to a Document span.

    quote must be a verbatim substring of the Document's raw_text at the
    given page. char_start and char_end are inclusive/exclusive offsets
    into the page's text.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    document_id: str
    page: int = Field(ge=1)
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)
    quote: str = Field(min_length=1)


class EventParty(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event_id: str
    party_id: str
    role_in_event: str


class Event(BaseModel):
    """A dated case event. Always has at least one Source when returned by the API.

    The persistence layer rejects insert attempts that lack a source. The
    list endpoint defensively drops orphans.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    date: str = Field(description="ISO date or ISO date range. Interpretation governed by date_precision.")
    date_precision: DatePrecision
    title: str
    description: str
    event_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_rationale: str
    sources: list[Source] = Field(min_length=1)
    parties: list[Party] = Field(default_factory=list)


class HealthResponse(BaseModel):
    ok: Literal[True] = True
    service: Literal["case-chronology-api"] = "case-chronology-api"
    version: str = "0.1.0"


class UploadDocumentResponse(BaseModel):
    """Returned from POST /documents.

    warning is non-null when extraction succeeded but produced degraded
    output, e.g. a scanned PDF with no text layer. The caller (and UI)
    should surface it.
    """

    document: DocumentSummary
    warning: str | None = None


class ExtractResponse(BaseModel):
    """Returned from POST /documents/{id}/extract."""

    document_id: str
    events_persisted: int = Field(ge=0)
    rejected_bad_quote: int = Field(ge=0)
    prompt_version: str
