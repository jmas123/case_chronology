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

## Phase 7: Narrative case + demo polish

Goal: a recorded demo that an interviewer can follow in under three minutes, anchored on a synthetic case where the timeline reveals something no single document does.

- [x] Rewrite `samples/sample-*.txt` so the three documents tell ONE case where the timeline exposes signals invisible from any single doc:
  - Date collision: deposition says Nov 1 (effective) vs complaint says Nov 7 (ceased) vs deposition's CFO memo on Nov 7. Three back-to-back cards.
  - Chain-of-custody gap: medical record Sep 20 (Reyes retains counsel) vs complaint Oct 3 (Acme first notified). 13-day window.
  - Missing event: deposition's Dec 18 CEO call appears as a single-source card; complaint omits it entirely.
- [x] `python -m app.db seed` loads the three docs, runs extraction end-to-end, and prints `Seeded 3 documents, extracted N events.` Live run produced 30 events, 1 quote rejected by the verifier.
- [ ] README screenshots: upload screen, timeline with conflict + duplicate badges visible, source drawer with multi-source groupyw
- [ ] Recorded demo gif (≤ 90s) checked into `docs/` showing the "oh" moment: open timeline, point at the red Nov 7 conflict, open the drawer to see Nov 1 vs Nov 7 with both sources
- [x] README "Try it" section names the seed command and the URL to open

---

## Phase 8: Extraction eval harness

Goal: numbers we can defend. Most "AI for legal" pitches skip evals. Ours doesn't.

- [x] `api/evals/cases/` holds one JSON per sample document listing every known event (date, parties, title). Source-span match left as a future tightening; current match gates are party + date.
- [x] `python -m app.evals run` runs extraction against each case with the current `PROMPT_VERSION`, matches predicted events to gold by party-overlap ≥ 1 AND date agreement (with title Jaccard as a tie-breaker only, per ARCHITECTURE), and computes precision + recall per case and overall
- [x] Output: stdout summary table AND `api/evals/reports/<prompt_version>.json` so prompt versions are comparable side by side
- [x] README table updated with the current numbers (28/28 recall, 0.93 precision on prompt `2026-05-24.v2`)
- [x] `pytest` test that loads the most recent report and fails if recall drops more than 10 percentage points from a baseline checked into `api/evals/baseline.json`
- [x] Document the metric definitions in ARCHITECTURE.md so the numbers aren't ambiguous

---

## Phase 9: Contradiction detection v2

Goal: extend Phase 6's date-conflict signal into substantive cross-document contradictions a paralegal can act on.

- [x] Grouping logic flags `description` divergence: same group, but the descriptions diverge on salient tokens (capitalized proper nouns and 4+ digit numbers / money amounts). Summary lists the divergent tokens.
- [x] Role contradiction: same party.id appears with different `role_in_event` across grouped events; per-party summary in the form `Globex: "payor" vs "non-paying party" vs "organization"`.
- [x] `Contradiction` type with `kind: "date" | "description" | "role"` and a per-kind `summary` string, exported from `web/lib/grouping.ts`.
- [x] `/contradictions` page (`web/app/contradictions/page.tsx`): lists every group with at least one contradiction, oldest first, with kind pills, per-kind summary lines, and source links.
- [x] Card pill becomes specific: "Date conflict" / "Role conflict" / "Account differs", one per kind, with the summary as a hover title. The duplicate badge stays for no-contradiction multi-event groups.
- [x] Grouping rules also tightened (trivial trailing-`s` stem, ≤ 60-day date cap) to keep the contradiction signal clean after lowering the title-Jaccard threshold to 0.2. Verified on the seeded case: surfaces Nov 1 vs Nov 7 payment-stoppage conflict and a model-error catch on the Jul 1 vs Jul 31 injury date.
- [ ] Tests for each contradiction kind on synthetic event groups (detectors are exported and ready; adding a web test framework deferred to keep the dependency surface tight).

---

## Phase 10: Trust UI, reasoning visible on the card

Goal: every claim shows not just confidence but *why* the model assigned that precision and that score. Trust is the thing legal customers actually buy.

- [ ] Below the date pill on each card, a one-line "because…" snippet derived from `confidence_rationale` + the source quote. Examples:
  - Exact: `because "on March 5, 2024"` (page 4)
  - Approximate: `because "in early September 2023"` (page 2)
  - Inferred: `confidence 0.4, "the following Monday"`
- [ ] Confidence dot has a `title` attribute with the full `confidence_rationale` (hover reveals)
- [ ] Drawer's confidence section is restructured: precision rationale + score rationale separately, with the anchoring snippet highlighted
- [ ] Lint rule or test: card layout collapses gracefully when rationale is empty (model can omit; UI must not break)

---

## Phase 11 (stretch): Statute-of-limitations report

Goal: one downstream artifact end-to-end. Picked SoL over depo prep because it has a clear right answer and a single screen.

- [ ] `web/app/sol/page.tsx`: one screen with a window selector (1y / 2y / 3y / 4y / custom) and a default of 4 years
- [ ] For each event group: compute `deadline = primary.date + window`, then `days_remaining = deadline - today`
- [ ] Table sorted by `days_remaining` ascending: red (past), amber (≤ 90 days), neutral (later). Filter: hide rows where `days_remaining > 365` by default.
- [ ] Per row: title, primary date, deadline, days remaining, source link, jump-to-drawer
- [ ] Document the SoL window assumption in the page header (this is not legal advice, it's a planning aid)
- [ ] CSV export of the visible rows (one button)
