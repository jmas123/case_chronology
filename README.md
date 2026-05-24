# Case Chronology Builder

A litigation tool that turns a stack of case documents into a verifiable, filterable timeline. Upload PDFs, .docx files, and plain text. An Anthropic-powered extraction agent pulls dated events, parties, and the exact source span for every claim. Every event in the UI traces back to a quote, a page, and a document.

## The problem

Paralegals build case chronologies by hand. They read hundreds of pages of complaints, depositions, and records, and copy dates and parties into a spreadsheet. The work is slow, error-prone, and hard to verify weeks later when an attorney asks "where did this date come from."

Case Chronology Builder automates the extraction and keeps the receipts. Every claim is one click from its source.

## Tech stack

- Next.js 14 (App Router), TypeScript strict, Tailwind, shadcn/ui
- FastAPI on Python 3.11+
- SQLite for the MVP, Postgres-ready schema
- Anthropic API, `claude-sonnet-4-6`, structured tool use
- pypdf, python-docx for document parsing

## Run it locally

Prereqs: Node 20+, Python 3.11+, an Anthropic API key.

```
cp .env.example .env       # add your ANTHROPIC_API_KEY

# Backend
cd api
python -m venv .venv && source .venv/bin/activate
pip install -e .
python -m app.db init
uvicorn app.main:app --reload --port 8001

# Frontend (new terminal)
cd web
npm install
npm run dev
```

Open http://localhost:3000.

Health checks:

```
curl http://localhost:8001/health
curl http://localhost:3000/api/health
```

## Screenshots

Placeholder. Replace with timeline, upload, and source drawer screenshots once Phase 3 and 4 land.

## Status and roadmap

See [ROADMAP.md](./ROADMAP.md) for the phased plan and acceptance criteria. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the extraction agent design and the verifiability guarantee.

## Limitations

- No OCR. Scanned PDFs without a text layer will produce empty extractions.
- Single-user. No auth, no collaboration.
- The extraction agent can miss events. The timeline is a draft assist, not a complete record.
