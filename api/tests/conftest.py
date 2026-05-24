"""Test fixtures.

Sets DATABASE_PATH and UPLOAD_DIR to a per-session tmpdir BEFORE importing
any app modules. db.py and routers/documents.py read these env vars at
module import time, so the override must happen first.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

_TMP_ROOT = Path(tempfile.mkdtemp(prefix="ccb-tests-"))
os.environ["DATABASE_PATH"] = str(_TMP_ROOT / "test.db")
os.environ["UPLOAD_DIR"] = str(_TMP_ROOT / "uploads")

import pytest  # noqa: E402

from app.db import reset  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    """Recreate the schema before each test for isolation."""
    reset()
    yield


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP_ROOT, ignore_errors=True)
