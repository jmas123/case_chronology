"""CLI entry point for `python -m app.evals`.

Usage:
    python -m app.evals run        # run extraction across cases, print, save report
"""

from __future__ import annotations

import sys

from app.evals.runner import run


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] != "run":
        print("Usage: python -m app.evals run", file=sys.stderr)
        sys.exit(1)
    run()


if __name__ == "__main__":
    main()
