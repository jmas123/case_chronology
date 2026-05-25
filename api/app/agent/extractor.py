"""Extraction agent loop.

Runs a per-chunk Anthropic tool-use conversation. The model calls
`record_event` once per event and `finish` when done. Every event's
source_quote is verified against the chunk before it survives; mismatches
get one corrective turn, capped to keep token spend bounded.

The Anthropic client is injectable so tests can drive the loop with
canned responses instead of real API calls.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.agent.prompts import PROMPT_VERSION, SYSTEM_PROMPT, build_user_message
from app.agent.tools import FINISH_TOOL, RECORD_EVENT_TOOL
from app.extractors import PAGE_SEP

DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
MAX_TOKENS = 4096
MAX_CORRECTIVE_TURNS = 2


@dataclass
class ExtractedParty:
    name: str
    role_in_event: str


@dataclass
class ExtractedEvent:
    date: str
    date_precision: str
    title: str
    description: str
    event_type: str
    parties: list[ExtractedParty]
    source_quote: str
    source_page: int
    source_char_start: int
    source_char_end: int
    confidence: float
    confidence_rationale: str


@dataclass
class ExtractionResult:
    events: list[ExtractedEvent] = field(default_factory=list)
    rejected_bad_quote: int = 0
    prompt_version: str = PROMPT_VERSION


class _MessagesClient(Protocol):
    """The subset of anthropic.Anthropic we use. Lets tests inject a fake."""

    def create(self, **kwargs: Any) -> Any: ...


class _AnthropicLike(Protocol):
    @property
    def messages(self) -> _MessagesClient: ...


def _default_client() -> _AnthropicLike:
    import anthropic

    return anthropic.Anthropic()


def _system_blocks() -> list[dict[str, Any]]:
    return [
        {
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def _tools_with_cache() -> list[dict[str, Any]]:
    # Cache the tools block too; system + tools are stable across calls.
    finish_with_cache = {**FINISH_TOOL, "cache_control": {"type": "ephemeral"}}
    return [RECORD_EVENT_TOOL, finish_with_cache]


def _chunks_for_document(raw_text: str, doc_type: str) -> list[tuple[int, str]]:
    """Return [(page, chunk_text), ...].

    PDF: one chunk per page (page 1..N).
    txt, docx: one chunk for the whole document, page=1.
    """
    if doc_type == "pdf":
        pages = raw_text.split(PAGE_SEP)
        return [(i + 1, text) for i, text in enumerate(pages) if text.strip()]
    return [(1, raw_text)] if raw_text.strip() else []


def _verify_quote(chunk: str, args: dict[str, Any]) -> str | None:
    """Verify the quote is a verbatim substring of the chunk.

    The model's source_char_start/end are unreliable (LLMs are poor at
    counting characters), so we treat them as hints and find the actual
    offset via str.find. The args dict is mutated in place to carry the
    corrected offsets back to the caller.

    Returns None on success, an error string on failure.
    """
    quote = args.get("source_quote", "")
    if not isinstance(quote, str) or not quote:
        return "source_quote must be a non-empty string."
    idx = chunk.find(quote)
    if idx == -1:
        return (
            "source_quote is not a verbatim substring of the chunk. "
            "Copy the quote character-for-character from the chunk, or skip "
            "this event if no verbatim anchor exists."
        )
    args["source_char_start"] = idx
    args["source_char_end"] = idx + len(quote)
    return None


def _to_event(args: dict[str, Any]) -> ExtractedEvent:
    """Coerce the model's tool_use args into a typed event.

    The tool schema marks all fields required, but the model occasionally
    omits the optional-feeling ones (`confidence_rationale`, `event_type`).
    The verifiability essentials (date, source_quote, source offsets) are
    accessed by key and will raise KeyError if missing, which is what we
    want; everything else falls back to a sensible default.
    """
    parties_raw = args.get("parties", []) or []
    parties = [
        ExtractedParty(name=p["name"], role_in_event=p.get("role_in_event", ""))
        for p in parties_raw
    ]
    return ExtractedEvent(
        date=args["date"],
        date_precision=args["date_precision"],
        title=args.get("title") or "(untitled)",
        description=args.get("description", ""),
        event_type=args.get("event_type", "uncategorized"),
        parties=parties,
        source_quote=args["source_quote"],
        source_page=args["source_page"],
        source_char_start=args["source_char_start"],
        source_char_end=args["source_char_end"],
        confidence=float(args.get("confidence", 0.5)),
        confidence_rationale=args.get("confidence_rationale", ""),
    )


def _extract_chunk(
    *,
    client: _AnthropicLike,
    model: str,
    filename: str,
    page: int,
    chunk: str,
) -> tuple[list[ExtractedEvent], int]:
    """Run the agent loop for one chunk. Returns (events, rejected_bad_quote)."""

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": build_user_message(filename=filename, page=page, chunk=chunk)}
    ]
    events: list[ExtractedEvent] = []
    rejected = 0
    corrective_turns_used = 0
    # Total loop iterations bounded: best case 1 (immediate finish),
    # typical 1-3, hard cap a bit above MAX_CORRECTIVE_TURNS to leave room
    # for the final response that calls finish.
    for _ in range(MAX_CORRECTIVE_TURNS + 3):
        response = client.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            system=_system_blocks(),
            tools=_tools_with_cache(),
            messages=messages,
        )

        tool_uses = [block for block in response.content if getattr(block, "type", None) == "tool_use"]
        if not tool_uses:
            break

        tool_results: list[dict[str, Any]] = []
        finished = False
        had_correction = False

        for block in tool_uses:
            name = block.name
            args = block.input if isinstance(block.input, dict) else {}
            if name == "finish":
                finished = True
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": "ok",
                    }
                )
            elif name == "record_event":
                err = _verify_quote(chunk, args)
                if err is None:
                    events.append(_to_event(args))
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": "recorded",
                        }
                    )
                else:
                    rejected += 1
                    had_correction = True
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": err,
                            "is_error": True,
                        }
                    )
            else:
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Unknown tool: {name}",
                        "is_error": True,
                    }
                )

        # Echo the assistant turn back so the conversation stays valid.
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

        if finished:
            break
        if had_correction:
            corrective_turns_used += 1
            if corrective_turns_used >= MAX_CORRECTIVE_TURNS:
                # Tell the model to stop attempting corrections and finish.
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Corrective-turn budget exhausted. Call `finish` with reason "
                            "'budget_exhausted' and do not record further events."
                        ),
                    }
                )

    return events, rejected


def extract_events(
    *,
    document_id: str,
    filename: str,
    raw_text: str,
    doc_type: str,
    client: _AnthropicLike | None = None,
    model: str | None = None,
) -> ExtractionResult:
    """Run extraction across every chunk of the document.

    document_id is not currently used inside the loop but kept on the
    signature for traceability when the persistence boundary calls us.
    """

    client = client or _default_client()
    model = model or DEFAULT_MODEL

    result = ExtractionResult()
    for page, chunk in _chunks_for_document(raw_text, doc_type):
        events, rejected = _extract_chunk(
            client=client, model=model, filename=filename, page=page, chunk=chunk
        )
        result.events.extend(events)
        result.rejected_bad_quote += rejected
    return result
