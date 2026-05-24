# Case Chronology Builder

## Mission

Case Chronology Builder is a litigation tool that ingests legal documents (PDF, .docx, .txt), extracts dated events with an Anthropic-powered agent, and renders a verifiable case timeline. Every event in the UI must trace back to an exact quote, page, and document. Paralegals upload a batch of materials, the system pulls events with parties, dates, and source spans, and the timeline supports filtering by party, document, event type, date range, and confidence threshold.

## Tech stack

- Frontend: Next.js 14 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui
- Backend: FastAPI on Python 3.11+
- Database: SQLite for the MVP. Schema is written so a Postgres swap is a small, contained change.
- AI: Anthropic API, model `claude-sonnet-4-6`, structured output via tool use
- Document parsing: pypdf (PDF), python-docx (.docx), plain read (.txt)
- Timeline UI: custom horizontal scroll component, no heavy timeline library

## Repo layout

```
case-chronology-builder/
  CLAUDE.md            project memory for Claude Code sessions
  ROADMAP.md           phased plan with acceptance criteria
  README.md            one-screen project summary
  ARCHITECTURE.md      extraction agent and verifiability design
  .env.example         environment template
  .gitignore
  web/                 Next.js 14 app
    app/               App Router pages and route handlers
    package.json
  api/                 FastAPI service
    app/
      main.py          FastAPI entrypoint
      schemas.py       Pydantic v2 models (source of truth)
      db.py            SQLite setup, init, seed stub
      routers/         route modules (health, ingest, events, ...)
    pyproject.toml
  shared/
    types.ts           TypeScript types mirroring Pydantic schemas
```

## Run commands

Frontend (from `web/`):

```
npm install
npm run dev          # http://localhost:3000
npm run build
npm run lint
npm run typecheck
```

Backend (from `api/`):

```
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload --port 8001   # http://localhost:8001
```

Database (from `api/`, with venv active):

```
python -m app.db init    # create tables
python -m app.db reset   # drop and recreate
python -m app.db seed    # seed stub, no-op until Phase 7
```

Smoke tests (from `api/`):

```
pytest -q
```

Health checks:

```
curl http://localhost:3000/api/health
curl http://localhost:8001/health
```

## Coding conventions

- TypeScript strict mode is on. No `any` without a written justification in a comment.
- Pydantic v2 models in `api/app/schemas.py` are the source of truth for data shapes. `shared/types.ts` mirrors them and is updated whenever the Pydantic models change.
- No em dashes anywhere, in code, comments, copy, or markdown. Use commas, periods, parentheses, or restructure the sentence.
- Errors are handled at boundaries (route handlers, agent calls, file parsing), not buried in helpers. Helpers raise, boundaries translate to HTTP responses.
- Prefer plain functions over classes in Python where reasonable. Use a class when state genuinely belongs together (extraction agent session, DB connection wrapper).
- Every FastAPI response is a typed Pydantic model, never a raw dict.
- Python: Ruff for lint and format. Frontend: prettier for TS and TSX.
- The extraction agent always returns sources. If it cannot identify a source span, the event is rejected at the persistence layer, not stored empty.

## The verifiability rule

Every Event rendered in the UI traces to at least one Source row containing the verbatim quote, page number, char range, and document id. The UI must never render an event without source attribution. This rule is enforced at three layers:

1. DB: `events` has no rows without at least one matching `sources` row. Insertion is wrapped in a transaction that rolls back if the source insert fails.
2. API: list endpoints join sources and exclude any orphan event defensively.
3. UI: the event card requires at least one source in its props; the type system rejects a sourceless event at compile time.

## In scope for v1

- Upload PDF, .docx, .txt
- Text extraction and page-level chunking
- Anthropic-powered event extraction with tool use
- Timeline UI with date precision rendering ("on or about", ranges, exact dates)
- Source attribution drawer (quote, page, document)
- Filtering by party, document, event type, date range, confidence
- Duplicate event detection across documents
- Three realistic synthetic seed documents

## Out of scope for v1

- Authentication and multi-user support
- Real-time collaboration
- OCR for scanned PDFs (text-layer PDFs only)
- Production deployment infrastructure
- Test coverage beyond a few smoke tests on the extraction path

## Known limitations to document, not hide

- Scanned PDFs without a text layer will produce empty extractions. Surface this in the upload UI as an explicit warning, do not silently skip.
- Date precision is best-effort. Phrases like "shortly after the meeting" cannot be anchored to a calendar date and are flagged low confidence with a textual rationale.
- The extraction agent can miss events. The UI must communicate that the timeline is a draft assist, not a complete record.
- Confidence scores are model-reported. They are useful as a relative signal, not an absolute probability.
