# Architecture

This doc covers the extraction agent design, the data flow from upload to render, and the verifiability guarantee.

## Data flow

```
upload
  -> file saved to api/uploads/{document_id}{ext}
  -> text extraction (pypdf | python-docx | plain read)
  -> page-level chunking, raw text persisted on the Document row
  -> extraction agent run per document
  -> Event rows persisted with required Source rows in one transaction
  -> GET /events joins sources and parties
  -> Timeline UI renders, drawer reveals quote and page on click
```

Each step has a clear failure mode and a single boundary that owns translating it to a user-facing error.

## Extraction agent

### Prompt structure

The prompt is a single system message plus one user message containing a document chunk. Sections:

1. Role and goal. Tell the model it is a litigation paralegal assistant, that its job is to extract dated events with verbatim source spans, and that fabricating a date or quote is the worst possible failure.
2. Definitions. Define Event, date_precision values (`exact`, `on_or_about`, `range`, `approximate`), and the rule that a quote must be a verbatim substring of the supplied text.
3. Output contract. Tell the model to call the `record_event` tool one time per event found, and to call `finish` when done.
4. Examples. Two or three few-shot examples showing tricky cases (on or about, range, approximate season).
5. Constraints. Emphasize: no event without a source quote, no source quote that is not verbatim, confidence is your honest self-rating, rationale must reference textual evidence.

The prompt lives in `api/app/agent/prompts.py` behind a version constant so changes are tracked.

### Tool schema

One tool: `record_event`. Schema (Pydantic mirror):

```
record_event(
  date: str,                        # ISO date or range
  date_precision: Literal["exact", "on_or_about", "range", "approximate"],
  title: str,
  description: str,
  event_type: str,                  # e.g. "filing", "communication", "medical"
  parties: list[ExtractedParty],    # name, role_in_event
  source_quote: str,                # verbatim substring of the chunk
  source_page: int,                 # 1-indexed
  source_char_start: int,
  source_char_end: int,
  confidence: float,                # 0..1
  confidence_rationale: str
)
```

A second tool, `finish`, signals completion. The agent loop terminates on `finish` or when the response contains no tool calls.

### Retry and confidence logic

- Verbatim check: after the model returns `source_quote`, the server verifies it is a substring of the chunk at `[char_start:char_end]`. If the check fails, the event is rejected and the model is given one corrective turn with the failed quote and the actual text at that span.
- Hard cap of two corrective turns per extraction call to keep token spend bounded.
- Events with `confidence < 0.4` are persisted but flagged for review. The UI surfaces this as a "needs review" badge.
- Events with no source span are not persisted at all. The model is told this in the prompt.

### Chunking strategy

For v1, one extraction call per page for PDF, one call for the whole document for .docx and .txt below a token budget. Document the heuristic and revisit if recall suffers.

## Verifiability guarantee

Every Event rendered in the UI is backed by at least one Source row containing the verbatim quote, the page number, the character range, and the document id. Three layers enforce this:

1. Database. The `events` table has no rows without at least one matching `sources` row. Insert is wrapped in a transaction: if the source insert fails, the event insert is rolled back. A nightly integrity check (later) can detect orphans defensively.
2. API. `GET /events` joins `sources`, drops any event with zero sources, logs a warning if this ever fires.
3. UI. The Event TypeScript type requires `sources: Source[]` with `sources.length >= 1`. The compiler rejects a sourceless event before rendering.

The rejection rule is the spine of the product. If we cannot show the quote, we do not show the claim.

## Data model summary

See `api/app/schemas.py` for the canonical Pydantic v2 definitions. `shared/types.ts` mirrors them.

- `Document(id, filename, type, uploaded_at, raw_text, page_count)`
- `Event(id, date, date_precision, title, description, event_type, confidence, confidence_rationale)`
- `Party(id, name, role, aliases)`
- `Source(id, event_id, document_id, page, char_start, char_end, quote)`
- `EventParty(event_id, party_id, role_in_event)`

## Phase 6 heuristics

These all live in the frontend (`web/lib/grouping.ts`, `web/lib/filters.ts`). Events are the data model; grouping is a view. The DB stores raw extraction output unmodified so a threshold change does not require a re-extract.

### Confidence floor (filter default)

The minimum-confidence filter defaults to `0.3` (`DEFAULT_MIN_CONFIDENCE` in `filters.ts`). Below that, model output is too noisy to be useful as a draft assist. A user who wants to see everything can drag the slider to `0` and the URL records the override. The agent itself uses `0.4` as the "low-confidence flag" threshold (per ARCHITECTURE earlier in this doc); the filter floor sits slightly below that on purpose, so a flagged-but-meaningful event isn't hidden by default.

### Needs-review badge

A group is flagged "Needs review" when any of its events meets either:

- `confidence < 0.5`, OR
- `date_precision == "approximate"` (the model could not anchor a calendar date).

These are independent signals: a high-confidence "approximate" date still needs human eyes because the date itself is fuzzy.

### Duplicate detection

Two events are considered the same underlying event when both:

1. They share at least one party (same `party.id`, which already passes through the server-side normalization in `repo.find_or_create_party`).
2. Their titles overlap with Jaccard ≥ `0.5` on content tokens (lowercased, stop-words removed, ≥3 chars).

A union-find pass over the filtered event list collapses transitive matches. The resulting groups become timeline cards. Within a group:

- All dates equal → **duplicate** (collapse, green ring, "×N" badge). The card surfaces the highest-confidence event; the drawer lists every source from every mention.
- Any dates differ → **conflict** (collapse, red ring, "Conflict (N)" badge). The drawer shows each event's date side by side so the paralegal can see who said what.

The bias is toward grouping: it is cheaper to surface a false-positive conflict in the drawer than to leave a real conflict hidden across two cards. Pairwise comparison is `O(N²)` and acceptable up to the 500-event cap; revisit when groups become slow.

### Where to retune

| Knob | File | Note |
|---|---|---|
| `DEFAULT_MIN_CONFIDENCE` | `web/lib/filters.ts` | Filter floor. |
| `TITLE_SIMILARITY_THRESHOLD` | `web/lib/grouping.ts` | Lower for more aggressive grouping. |
| `REVIEW_CONFIDENCE_THRESHOLD` | `web/lib/grouping.ts` | Above this, no "Needs review" badge from confidence alone. |
| `STOP_WORDS` | `web/lib/grouping.ts` | Domain-specific noise words. |

## Phase 8: Extraction eval

The eval lives in `api/app/evals/` (code) and `api/evals/` (data and reports). Numbers are written per prompt version so a regression is visible across runs.

### What is being measured

For each gold case, we count:

- **TP (true positive):** a gold event that was matched by a predicted event (party-overlap ≥ 1 AND date agreement; see "Matching rules" below).
- **FN (false negative):** a gold event with no matching predicted event. *The agent missed it.*
- **FP (false positive):** a predicted event that was not claimed by any gold event. *The agent surfaced something extra.*

From those:

- **precision** = TP / (TP + FP). Of what the agent claimed, how much was correct.
- **recall** = TP / (TP + FN). Of what should have been claimed, how much actually was.

Recall is the regression-critical metric: missed events are how a chronology hurts a paralegal. Precision is a quality signal but a FP is recoverable (the paralegal sees the card and decides). A FN is invisible.

### Matching rules

A predicted event matches a gold event when both:

1. **Party overlap ≥ 1.** Names are normalized (lowercase, legal suffixes stripped via the same list as `repo.find_or_create_party`); substring containment counts so "Acme" matches "Acme Corporation".
2. **Date agreement.** Exact ISO equality, OR either side has `date_precision == "approximate"` and year-month prefixes match, OR either side has `date_precision == "range"` and the windows overlap.

Title is intentionally NOT a gating criterion. The model legitimately rewrites titles ("MSA entered" vs "Master Services Agreement executed") and a token-Jaccard gate produces a wave of false negatives that confuse the regression signal. Title Jaccard is used only as a tie-breaker when two predicted events could fit one gold event.

Matching is greedy: gold events are walked in declaration order. For each gold, every unclaimed predicted is scored by title Jaccard, and the best score wins. A more elaborate assignment (Hungarian, score-weighted) is overkill at this dataset size.

### Regression test

`api/tests/test_evals.py` loads the most recent report from `api/evals/reports/` and compares per-case recall against `api/evals/baseline.json`. A drop greater than `regression_threshold_pp` (default 10pp) on any case fails the test. The test skips when no report exists, so contributors without an API key are not blocked.

### When to update the baseline

After a deliberate prompt or model change that improves recall, re-run the eval and copy the per-case recall floors into `baseline.json`. Never copy precision floors automatically; precision changes are usually a judgment call (did the agent surface something useful that the gold should add, or something noisy that the prompt should suppress?). The baseline file has a `notes` field; use it.

## Open questions, tracked

- Page numbering for .docx: paragraphs as a single page is a stopgap. Consider page-break detection later.
- Large documents: hard limit on tokens per chunk, batched extraction. Revisit when a real complaint blows the budget.
- Server-side grouping: currently client-side. If a second consumer (mobile, export) shows up, move to the API.
- Gold set growth: the eval currently runs on three synthetic docs. Real signal comes from client-mix gold per representative document type.
