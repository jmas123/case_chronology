"""Run extraction against each gold case, score it, and emit a report.

Read by:
- the CLI: `python -m app.evals run`
- the regression test: tests/test_evals.py loads the most recent report and
  compares against `api/evals/baseline.json`.

Reports are written to api/evals/reports/<prompt_version>.json. A run with
the same prompt version overwrites its prior report (the assumption is that
the prompt version is what's varying; if not, bump it).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.agent.extractor import extract_events
from app.agent.prompts import PROMPT_VERSION
from app.evals.matcher import (
    EvalReport,
    GoldEvent,
    PredictedEvent,
    aggregate,
    evaluate_case,
)


# Repo layout: <root>/api/app/evals/runner.py
# evals/{cases,reports} live at <root>/api/evals/
REPO_ROOT = Path(__file__).resolve().parents[3]
EVALS_DIR = REPO_ROOT / "api" / "evals"
CASES_DIR = EVALS_DIR / "cases"
REPORTS_DIR = EVALS_DIR / "reports"
SAMPLES_DIR = REPO_ROOT / "samples"
DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")


def _load_gold_cases() -> list[dict]:
    cases = []
    for path in sorted(CASES_DIR.glob("*.json")):
        with path.open() as fh:
            cases.append(json.load(fh))
    return cases


def _read_sample(filename: str) -> str:
    return (SAMPLES_DIR / filename).read_text(encoding="utf-8")


def _print_table(report: EvalReport) -> None:
    rows = [
        ("case", "tp", "fp", "fn", "precision", "recall"),
    ]
    for c in report.per_case:
        rows.append(
            (c.case, str(c.tp), str(c.fp), str(c.fn), f"{c.precision:.2f}", f"{c.recall:.2f}")
        )
    rows.append(
        (
            "OVERALL",
            str(report.overall.tp),
            str(report.overall.fp),
            str(report.overall.fn),
            f"{report.overall.precision:.2f}",
            f"{report.overall.recall:.2f}",
        )
    )
    widths = [max(len(r[i]) for r in rows) for i in range(6)]
    for i, r in enumerate(rows):
        line = "  ".join(cell.ljust(widths[j]) for j, cell in enumerate(r))
        print(line)
        if i == 0 or i == len(rows) - 2:
            print("  ".join("-" * w for w in widths))


def run() -> EvalReport:
    if not os.getenv("ANTHROPIC_API_KEY"):
        print(
            "ANTHROPIC_API_KEY is not set. The eval runs the real extraction "
            "agent against the sample cases and needs a real key.",
            file=sys.stderr,
        )
        sys.exit(1)

    gold_cases = _load_gold_cases()
    if not gold_cases:
        print(f"No gold cases found in {CASES_DIR}", file=sys.stderr)
        sys.exit(1)

    per_case = []
    for case in gold_cases:
        filename = case["case"]
        print(f"  extracting {filename}...", file=sys.stderr)
        raw_text = _read_sample(filename)
        extraction = extract_events(
            document_id=filename,
            filename=filename,
            raw_text=raw_text,
            doc_type="txt",
        )
        predicted = [
            PredictedEvent(
                title=e.title,
                date=e.date,
                date_precision=e.date_precision,
                parties=[p.name for p in e.parties],
            )
            for e in extraction.events
        ]
        gold = [
            GoldEvent(
                title=g["title"],
                date=g["date"],
                date_precision=g["date_precision"],
                parties=list(g["parties"]),
            )
            for g in case["events"]
        ]
        per_case.append(evaluate_case(filename, gold, predicted))

    report = EvalReport(
        prompt_version=PROMPT_VERSION,
        model=DEFAULT_MODEL,
        run_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        overall=aggregate(per_case),
        per_case=per_case,
    )

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / f"{PROMPT_VERSION}.json"
    with report_path.open("w") as fh:
        json.dump(report.to_dict(), fh, indent=2, default=str)

    print()
    _print_table(report)
    print()
    print(f"Report saved to {report_path.relative_to(REPO_ROOT)}")
    return report


def latest_report() -> dict | None:
    """Return the most recently modified report as a dict, or None."""
    if not REPORTS_DIR.is_dir():
        return None
    reports = sorted(REPORTS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not reports:
        return None
    with reports[0].open() as fh:
        return json.load(fh)
