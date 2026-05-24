// Pydantic v2 models in api/app/schemas.py are the source of truth.
// Update this file in the same change whenever the Pydantic models change.

export type DatePrecision = "exact" | "on_or_about" | "range" | "approximate";

export type DocumentType = "pdf" | "docx" | "txt";

export type PartyRole =
  | "plaintiff"
  | "defendant"
  | "witness"
  | "counsel"
  | "third_party"
  | "unknown";

export interface Document {
  id: string;
  filename: string;
  type: DocumentType;
  uploaded_at: string; // ISO 8601
  raw_text: string;
  page_count: number;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  type: DocumentType;
  uploaded_at: string;
  page_count: number;
}

export interface Party {
  id: string;
  name: string;
  role: PartyRole;
  aliases: string[];
  // Populated when this Party is returned inside an Event (GET /events).
  // The party's role for that specific event, e.g. "filer", "recipient".
  // Null in standalone party listings.
  role_in_event: string | null;
}

export interface Source {
  id: string;
  event_id: string;
  document_id: string;
  page: number;
  char_start: number;
  char_end: number;
  quote: string;
}

export interface EventParty {
  event_id: string;
  party_id: string;
  role_in_event: string;
}

// An Event always carries at least one Source. The API drops orphans and
// the persistence layer rejects sourceless inserts. The compile-time
// guarantee is the [Source, ...Source[]] tuple form: it requires length >= 1.
export interface Event {
  id: string;
  date: string;
  date_precision: DatePrecision;
  title: string;
  description: string;
  event_type: string;
  confidence: number;
  confidence_rationale: string;
  sources: [Source, ...Source[]];
  parties: Party[];
}

export interface HealthResponse {
  ok: true;
  service: "case-chronology-api";
  version: string;
}

export interface UploadDocumentResponse {
  document: DocumentSummary;
  warning: string | null;
}

export interface ExtractResponse {
  document_id: string;
  events_persisted: number;
  rejected_bad_quote: number;
  prompt_version: string;
}
