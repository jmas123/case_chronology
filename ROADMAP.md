# Roadmap

Phased plan. Do not start a phase until the prior phase passes every acceptance criterion. Check items off as they land.

---

## Phase 0: Scaffolding

Goal: both apps run, both expose `/health`, shared types compile, SQLite schema initializes.

- [x] Next.js 14 app created under `web/` with App Router, TypeScript strict, Tailwind, ESLint
- [x] FastAPI app created under `api/` with Pydantic v2, uvicorn, pinned versions
- [x] `web/app/api/health/route.ts` returns `{ ok: true }` with status 200
- [x] `api/app/main.py` exposes `GET /health` returning a typed Pydantic response
- [x] `api/app/schemas.py` defines all v1 Pydantic models (Document, Event, Party, Source, EventParty, DatePrecision enum)
- [x] `shared/types.ts` mirrors the Pydantic schemas with a header comment naming Pydantic as the source of truth
- [x] `api/app/db.py` creates the SQLite schema on `python -m app.db init`
- [x] `.env.example`, `.gitignore`, root `README.md` in place
- [x] `curl http://localhost:3000/api/health` returns 200
- [x] `curl http://localhost:8001/health` returns 200

---

## Phase 1: Document ingestion

Goal: upload a file, store it, extract text page-by-page, list documents in the UI.

- [x] `POST /documents` accepts multipart upload, validates extension (pdf, docx, txt)
- [x] Files saved to `api/uploads/` with a generated id, original filename preserved on the Document row
- [x] PDF extraction via pypdf returns text plus page boundaries
- [x] .docx extraction via python-docx returns full text. Page boundaries are best-effort (paragraphs treated as a single page when no break information is present, documented behavior)
- [x] .txt is read directly, treated as a single page
- [x] Document row persisted with `raw_text` and `page_count`
- [x] `GET /documents` returns the list of uploaded documents
- [x] Web UI: upload form, document list page, empty state, error state for unsupported types
- [x] Scanned PDF without text layer surfaces a clear warning to the user

---

## Phase 2: Extraction agent

Goal: run Anthropic tool-use extraction on a document, persist events with sources, capture confidence and rationale.

- [x] Prompt template lives in `api/app/agent/prompts.py`, versioned with a constant
- [x] Anthropic tool schema for `record_event` defined in `api/app/agent/tools.py`, with date, date_precision, title, description, event_type, parties, source quote, page, char_start, char_end, confidence, confidence_rationale
- [x] `POST /documents/{id}/extract` runs extraction synchronously for the MVP
- [x] Events with no source are rejected before insert. Test verifies this.
- [x] Confidence and rationale persisted on every Event row
- [x] Source rows persisted with verbatim quote, page, char_start, char_end
- [x] Parties deduplicated by normalized name and alias matching
- [x] Smoke test: feed a fixture document, assert at least one event with a non-empty source quote

---

## Phase 3: Timeline UI

Goal: render the timeline with date precision visuals, loading, empty, and error states.

- [x] Custom horizontal scroll container, no external timeline library
- [x] Event card shows date, title, parties, event type, confidence indicator
- [x] Date precision rendering: exact dates render plain, "on or about" renders with a tilde or label, ranges render with a span, "early 2023" style renders with a soft bracket
- [x] Loading skeleton when fetching events
- [x] Empty state when no events exist
- [x] Error state when the events endpoint fails
- [x] Timeline reads from `GET /events`, response is capped at 500 (see `repo.EVENT_LIST_CAP`); swap for cursor pagination when this becomes a real limit

---

## Phase 4: Source attribution drawer

Goal: every event card opens a drawer that proves the claim.

- [x] Click on an event card opens a right-side drawer
- [x] Drawer shows the verbatim quote, page number, document filename
- [x] Drawer links to a document viewer that highlights the quote in context
- [x] Drawer handles events with multiple sources (cite-of-cite case)
- [x] Keyboard: Escape closes the drawer, focus returns to the triggering card

---

## Phase 5: Filtering

Goal: useful filtering for a paralegal scanning a case.

- [x] Filter by party (multi-select)
- [x] Filter by document (multi-select)
- [x] Filter by event type (multi-select)
- [x] Filter by date range
- [x] Filter by minimum confidence
- [x] Filters are URL-encoded so views are shareable
- [x] Result count visible at all times, "no matches" empty state distinct from the "no events yet" empty state

---

## Phase 6: Edge cases

Goal: handle the cases that make this tool feel real instead of a demo.

- [x] Ambiguous dates flagged with low confidence and surfaced in a "needs review" badge
- [x] Conflicting timestamps across documents: events that look like the same event but disagree on date are grouped with a conflict indicator
- [x] Duplicate event detection: same date, similar title, overlapping parties collapses into one card with multiple sources
- [x] Low-confidence threshold visible in the filter UI, defaulted to a reasonable floor
- [x] Documented heuristics in ARCHITECTURE.md for each of the above

---

## Phase 7: Demo polish

Goal: a recorded demo that an interviewer can follow in under three minutes.

- [ ] Three realistic synthetic seed documents: complaint, deposition excerpt, medical record
- [ ] `python -m app.db seed` loads the seeds and runs extraction end-to-end
- [ ] README screenshots: upload screen, timeline, source drawer
- [ ] Recorded demo gif checked into `docs/`
- [ ] README "Try it" section names the seed command and the URL to open
