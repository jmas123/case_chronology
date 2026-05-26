// Filter state, URL encoding, and event filtering. Pure logic, no React.
//
// URL params (all optional, empty = no filter on that dimension):
//   party=<id>,<id>            multi-select by party id
//   document=<id>,<id>         multi-select by document id
//   type=<label>,<label>       multi-select by event_type
//   from=YYYY-MM-DD            inclusive lower bound on event date
//   to=YYYY-MM-DD              inclusive upper bound on event date
//   min_conf=0.0..1.0          minimum confidence (default 0)

import type { Event } from "@shared/types";

export interface Filters {
  partyIds: string[];
  documentIds: string[];
  eventTypes: string[];
  dateFrom: string | null;
  dateTo: string | null;
  minConfidence: number;
}

// Floor applied by default to keep the timeline focused on signal rather
// than the noisiest model outputs. Documented in ARCHITECTURE.md, Phase 6.
export const DEFAULT_MIN_CONFIDENCE = 0.3;

export const EMPTY_FILTERS: Filters = {
  partyIds: [],
  documentIds: [],
  eventTypes: [],
  dateFrom: null,
  dateTo: null,
  minConfidence: DEFAULT_MIN_CONFIDENCE,
};

export function filtersAreEmpty(f: Filters): boolean {
  return (
    f.partyIds.length === 0 &&
    f.documentIds.length === 0 &&
    f.eventTypes.length === 0 &&
    f.dateFrom === null &&
    f.dateTo === null &&
    f.minConfidence <= DEFAULT_MIN_CONFIDENCE
  );
}

function parseCSV(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function parseConfidence(value: string | null): number {
  // Missing param => apply the project-wide floor. Explicit 0 in the URL
  // is honored (user opted to see everything).
  if (value === null) return DEFAULT_MIN_CONFIDENCE;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MIN_CONFIDENCE;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function filtersFromURL(params: URLSearchParams): Filters {
  return {
    partyIds: parseCSV(params.get("party")),
    documentIds: parseCSV(params.get("document")),
    eventTypes: parseCSV(params.get("type")),
    dateFrom: parseDate(params.get("from")),
    dateTo: parseDate(params.get("to")),
    minConfidence: parseConfidence(params.get("min_conf")),
  };
}

export function filtersToSearchString(f: Filters): string {
  const params = new URLSearchParams();
  if (f.partyIds.length) params.set("party", f.partyIds.join(","));
  if (f.documentIds.length) params.set("document", f.documentIds.join(","));
  if (f.eventTypes.length) params.set("type", f.eventTypes.join(","));
  if (f.dateFrom) params.set("from", f.dateFrom);
  if (f.dateTo) params.set("to", f.dateTo);
  // Persist min_conf only when it diverges from the project default, so a
  // pristine view doesn't carry a stale query string.
  if (Math.abs(f.minConfidence - DEFAULT_MIN_CONFIDENCE) > 1e-6)
    params.set("min_conf", f.minConfidence.toFixed(2));
  return params.toString();
}

// Parse an Event.date by precision into a [start, end] window (both ISO YYYY-MM-DD).
// Used for date-range filtering with interval overlap semantics.
export function eventDateWindow(event: Event): [string, string] {
  if (event.date_precision === "range") {
    const [s, e] = event.date.split("/");
    return [s, e ?? s];
  }
  return [event.date, event.date];
}

export function applyFilters(events: Event[], f: Filters): Event[] {
  return events.filter((event) => {
    if (f.minConfidence > 0 && event.confidence < f.minConfidence) return false;

    if (f.eventTypes.length > 0 && !f.eventTypes.includes(event.event_type)) return false;

    if (f.partyIds.length > 0) {
      const partyHit = event.parties.some((p) => f.partyIds.includes(p.id));
      if (!partyHit) return false;
    }

    if (f.documentIds.length > 0) {
      const docHit = event.sources.some((s) => f.documentIds.includes(s.document_id));
      if (!docHit) return false;
    }

    if (f.dateFrom || f.dateTo) {
      const [start, end] = eventDateWindow(event);
      // Interval overlap: [start, end] intersects [from, to] iff start <= to && end >= from.
      if (f.dateTo && start > f.dateTo) return false;
      if (f.dateFrom && end < f.dateFrom) return false;
    }

    return true;
  });
}

// Distinct party options across events, sorted by name. Parties without an id
// are not derivable — they only appear via Event.parties so they always have one.
export function partyOptionsFromEvents(events: Event[]): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  for (const event of events) {
    for (const party of event.parties) {
      if (!byId.has(party.id)) byId.set(party.id, party.name);
    }
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function eventTypeOptionsFromEvents(events: Event[]): string[] {
  const set = new Set<string>();
  for (const event of events) set.add(event.event_type);
  return Array.from(set).sort();
}
