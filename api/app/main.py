import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import auto_seed_if_empty, init
from app.routers import documents, events, health


def _parse_origins() -> list[str]:
    """Comma-separated ALLOWED_ORIGINS env var, falling back to local dev.
    3001 is Next's fallback when 3000 is occupied.
    """
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return ["http://localhost:3000", "http://localhost:3001"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init()
    if os.getenv("SEED_ON_STARTUP", "false").lower() == "true":
        # Extraction is slow and synchronous; run in a thread so the
        # healthcheck endpoint responds immediately on cold boot.
        threading.Thread(target=auto_seed_if_empty, daemon=True).start()
    yield


app = FastAPI(
    title="Case Chronology API",
    version="0.1.0",
    description="Document ingestion, extraction agent, timeline API.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(documents.router)
app.include_router(events.router)
