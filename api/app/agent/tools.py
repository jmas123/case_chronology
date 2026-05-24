"""Anthropic tool schemas. JSON Schema dicts handed directly to the SDK.

Two tools:
- record_event: called once per event found. Fields mirror Event + Source
  + Party shapes from app.schemas.
- finish: called exactly once at the end. Signals the loop to terminate.
"""

from __future__ import annotations

from typing import Any

RECORD_EVENT_TOOL: dict[str, Any] = {
    "name": "record_event",
    "description": (
        "Record one dated event extracted from the document chunk. Call once per event. "
        "The source_quote must be a verbatim substring of the chunk; the server verifies this."
    ),
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "date",
            "date_precision",
            "title",
            "description",
            "event_type",
            "parties",
            "source_quote",
            "source_page",
            "source_char_start",
            "source_char_end",
            "confidence",
            "confidence_rationale",
        ],
        "properties": {
            "date": {
                "type": "string",
                "description": (
                    "ISO 8601 date (YYYY-MM-DD) or ISO range (YYYY-MM-DD/YYYY-MM-DD). "
                    "Interpretation governed by date_precision."
                ),
            },
            "date_precision": {
                "type": "string",
                "enum": ["exact", "on_or_about", "range", "approximate"],
            },
            "title": {
                "type": "string",
                "description": "Short imperative-style label, e.g. 'Complaint filed', 'Meeting at HQ'.",
            },
            "description": {
                "type": "string",
                "description": "One- to two-sentence summary of what happened.",
            },
            "event_type": {
                "type": "string",
                "description": "Short lowercase label like 'filing', 'communication', 'medical', 'transaction'.",
            },
            "parties": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name", "role_in_event"],
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Entity name as written in the chunk.",
                        },
                        "role_in_event": {
                            "type": "string",
                            "description": "Short phrase, e.g. 'filer', 'recipient', 'patient'.",
                        },
                    },
                },
            },
            "source_quote": {
                "type": "string",
                "description": "Verbatim substring of the chunk text. Must match exactly.",
            },
            "source_page": {
                "type": "integer",
                "minimum": 1,
                "description": "1-indexed page number provided in the user message.",
            },
            "source_char_start": {
                "type": "integer",
                "minimum": 0,
                "description": "0-indexed start offset of source_quote within the chunk.",
            },
            "source_char_end": {
                "type": "integer",
                "minimum": 0,
                "description": "Exclusive end offset, i.e. chunk[start:end] == source_quote.",
            },
            "confidence": {
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0,
                "description": "Honest self-rating. <0.5 for hedged language.",
            },
            "confidence_rationale": {
                "type": "string",
                "description": "Reference the textual evidence that drove the confidence score.",
            },
        },
    },
}


FINISH_TOOL: dict[str, Any] = {
    "name": "finish",
    "description": "Call exactly once when you have recorded every event in the chunk (or none).",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["reason"],
        "properties": {
            "reason": {
                "type": "string",
                "description": "Short note, e.g. 'all_events_recorded' or 'no_events'.",
            },
        },
    },
}


TOOLS: list[dict[str, Any]] = [RECORD_EVENT_TOOL, FINISH_TOOL]
