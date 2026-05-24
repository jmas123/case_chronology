"""Timeline event listing.

GET /events    capped list of events with sources + parties hydrated,
               ordered by date ascending. Cap documented in repo.EVENT_LIST_CAP.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.repo import EVENT_LIST_CAP, list_events
from app.schemas import Event

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[Event])
def list_all_events() -> list[Event]:
    return list_events(limit=EVENT_LIST_CAP)
