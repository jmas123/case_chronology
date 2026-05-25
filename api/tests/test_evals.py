"""Regression guard for the extraction agent.

Loads the most recent report in `api/evals/reports/` and compares its
per-case recall against `api/evals/baseline.json`. A drop greater than
`regression_threshold_pp` percentage points fails the test.

The test SKIPS when no report exists yet (CI without the API key, fresh
checkout). It only fires when someone has actually run `python -m app.evals
run` recently. This is intentional: the eval is gated on a real API key.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.evals.runner import latest_report

BASELINE_PATH = Path(__file__).resolve().parents[1] / "evals" / "baseline.json"


def test_extraction_recall_does_not_regress_from_baseline():
    report = latest_report()
    if report is None:
        pytest.skip("No eval report found. Run `python -m app.evals run` to generate one.")

    if not BASELINE_PATH.exists():
        pytest.skip(f"Baseline not found at {BASELINE_PATH}.")

    with BASELINE_PATH.open() as fh:
        baseline = json.load(fh)

    threshold_pp = float(baseline.get("regression_threshold_pp", 10))
    threshold = threshold_pp / 100.0

    report_by_case = {c["case"]: c for c in report["per_case"]}
    regressions: list[str] = []

    for case_name, expected in baseline["per_case"].items():
        current = report_by_case.get(case_name)
        if current is None:
            regressions.append(
                f"{case_name}: missing from latest report (baseline expected recall "
                f"{expected['recall']:.2f})"
            )
            continue
        drop = expected["recall"] - current["recall"]
        if drop > threshold:
            regressions.append(
                f"{case_name}: recall {current['recall']:.2f} vs baseline {expected['recall']:.2f} "
                f"(drop {drop:.2f} > threshold {threshold:.2f})"
            )

    overall_drop = baseline["overall"]["recall"] - report["overall"]["recall"]
    if overall_drop > threshold:
        regressions.append(
            f"OVERALL: recall {report['overall']['recall']:.2f} vs baseline "
            f"{baseline['overall']['recall']:.2f} (drop {overall_drop:.2f} > threshold {threshold:.2f})"
        )

    assert not regressions, (
        "Extraction recall regressed beyond the baseline threshold:\n  "
        + "\n  ".join(regressions)
    )
