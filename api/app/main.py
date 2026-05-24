from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import documents, events, health

app = FastAPI(
    title="Case Chronology API",
    version="0.1.0",
    description="Document ingestion, extraction agent, timeline API.",
)

# CORS for the Next.js dev server. Tighten before any non-local deploy.
# 3000 is the default; 3001 is what Next falls back to when 3000 is occupied.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(documents.router)
app.include_router(events.router)
