// Group near-duplicate events for the timeline.
//
// Two events are considered the "same underlying event" when they share at
// least one party AND their titles overlap meaningfully (Jaccard ≥ 0.5 on
// content tokens). Connected components form a group.
//
// Within a group, three independent contradiction detectors run:
//   - date          → 2+ distinct event dates (existing isConflict signal)
//   - role          → same party.id appears with different role_in_event
//   - description   → salient tokens (proper nouns, 4+ digit numbers, money
//                     amounts) appear in some descriptions but not others
//
// Each fires independently and is recorded on EventGroup.contradictions.
// isConflict stays as a convenience boolean ("any contradiction present")
// for older call sites.
//
// Heuristic thresholds are documented in ARCHITECTURE.md, Phase 6 and 9.
// The rule of thumb: prefer false positives (surface the disagreement and
// let the paralegal judge) over false negatives (hide a real conflict).

import type { Event, Source } from "@shared/types";

// Lowered from 0.5 after Phase 8 eval showed the agent legitimately rewrites
// titles across documents ("Globex ceases payments" vs "CFO confirms payment
// stoppage decision"). A loose gate plus the shared-party requirement keeps
// false-positive grouping rare; precision is the contradiction summary in the
// drawer, which a paralegal can dismiss in a glance.
const TITLE_SIMILARITY_THRESHOLD = 0.2;
const REVIEW_CONFIDENCE_THRESHOLD = 0.5;
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "and",
  "or",
  "for",
  "with",
  "from",
]);

export type ContradictionKind = "date" | "description" | "role";

export interface Contradiction {
  kind: ContradictionKind;
  summary: string;
}

export interface EventGroup {
  id: string;
  events: Event[];
  primary: Event; // highest-confidence event in the group, the one shown on the card
  allSources: Source[];
  isDuplicate: boolean; // 2+ events, all on the same date, no other contradiction
  isConflict: boolean; // contradictions.length > 0 (convenience boolean)
  needsReview: boolean; // any event in group is low-confidence or date_precision="approximate"
  contradictions: Contradiction[];
}

// Trivial stem: trailing 's' on tokens >4 chars so "payment" matches
// "payments" and "visit" matches "visits". Enough to catch the agent's
// plural rewrites without pulling in a stemming library.
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function normalizeTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
      .map(stem),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function sharedPartyCount(a: Event, b: Event): number {
  const ids = new Set(a.parties.map((p) => p.id));
  let n = 0;
  for (const p of b.parties) if (ids.has(p.id)) n++;
  return n;
}

// Days between two ISO date strings, using the start of any range.
function daysBetween(aDate: string, bDate: string): number {
  const aStart = aDate.split("/")[0];
  const bStart = bDate.split("/")[0];
  const a = Date.parse(aStart);
  const b = Date.parse(bStart);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs((a - b) / 86_400_000);
}

const MAX_GROUPING_DATE_DAYS = 60;

function makeUF(n: number): { find: (i: number) => number; union: (a: number, b: number) => void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { find, union };
}

// ----- Contradiction detectors -------------------------------------------

export function detectDateContradiction(events: Event[]): Contradiction | null {
  if (events.length < 2) return null;
  const dates = Array.from(new Set(events.map((e) => e.date))).sort();
  if (dates.length < 2) return null;
  return {
    kind: "date",
    summary: `Sources disagree on the date: ${dates.join(" vs ")}`,
  };
}

export function detectRoleContradiction(events: Event[]): Contradiction | null {
  if (events.length < 2) return null;
  // party_id → set of distinct normalized role_in_event values
  const roles = new Map<string, { name: string; roles: Set<string> }>();
  for (const event of events) {
    for (const party of event.parties) {
      const role = (party.role_in_event ?? "").trim().toLowerCase();
      if (!role) continue;
      const entry = roles.get(party.id) ?? { name: party.name, roles: new Set() };
      entry.roles.add(role);
      roles.set(party.id, entry);
    }
  }
  const disagreements: string[] = [];
  for (const { name, roles: values } of roles.values()) {
    if (values.size > 1) {
      disagreements.push(`${name}: ${Array.from(values).map((r) => `"${r}"`).join(" vs ")}`);
    }
  }
  if (disagreements.length === 0) return null;
  return {
    kind: "role",
    summary: `Parties play different roles across sources. ${disagreements.join("; ")}`,
  };
}

// "Salient" tokens worth comparing across descriptions:
//   - words starting with a capital letter mid-sentence (proper nouns, titles)
//   - 4+ digit runs (years, dollar amounts)
//   - money amounts ($1.2 million)
// Common sentence-start words ("The", "On") are filtered.
const SENTENCE_STARTERS = new Set([
  "The",
  "On",
  "A",
  "An",
  "At",
  "In",
  "He",
  "She",
  "They",
  "It",
  "We",
  "I",
  "After",
  "Before",
  "During",
  "Plaintiff",
  "Defendant",
  "Counsel",
]);

function salientTokens(text: string): Set<string> {
  const out = new Set<string>();
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].replace(/[.,;:!?()"]/g, "");
    if (!raw) continue;
    // 4+ digit number (years, dollar amounts, MRN-style ids)
    if (/^\d{4,}$/.test(raw)) {
      out.add(raw);
      continue;
    }
    // Money like $1.2 or $1,200,000
    if (/^\$[\d,.]+$/.test(raw)) {
      out.add(raw);
      continue;
    }
    // Capitalized mid-sentence word that isn't a common starter
    if (
      /^[A-Z][a-zA-Z'’\-]{2,}$/.test(raw) &&
      !SENTENCE_STARTERS.has(raw) &&
      i > 0 // not the first token of the description
    ) {
      out.add(raw);
    }
  }
  return out;
}

export function detectDescriptionContradiction(events: Event[]): Contradiction | null {
  if (events.length < 2) return null;
  const perEvent = events.map((e) => salientTokens(e.description));
  // Tokens present in some events but not others. We compare each token's
  // membership across all event token sets; if it's in some-but-not-all,
  // it's a divergence.
  const universe = new Set<string>();
  for (const set of perEvent) for (const t of set) universe.add(t);
  const divergent: string[] = [];
  for (const token of universe) {
    const present = perEvent.filter((s) => s.has(token)).length;
    if (present > 0 && present < events.length) divergent.push(token);
  }
  if (divergent.length === 0) return null;
  // Cap the summary so it stays one line.
  const shown = divergent.slice(0, 6);
  const more = divergent.length > shown.length ? ` (+${divergent.length - shown.length} more)` : "";
  return {
    kind: "description",
    summary: `Accounts differ on specifics: ${shown.join(", ")}${more}`,
  };
}

function detectContradictions(events: Event[]): Contradiction[] {
  const out: Contradiction[] = [];
  const date = detectDateContradiction(events);
  if (date) out.push(date);
  const role = detectRoleContradiction(events);
  if (role) out.push(role);
  const description = detectDescriptionContradiction(events);
  if (description) out.push(description);
  return out;
}

// ----- Public API --------------------------------------------------------

export function groupEvents(events: Event[]): EventGroup[] {
  if (events.length === 0) return [];

  const tokens = events.map((e) => normalizeTokens(e.title));
  const uf = makeUF(events.length);

  // O(N²) pairwise merge. Acceptable up to a few hundred events; revisit if
  // we approach the EVENT_LIST_CAP of 500 routinely.
  //
  // Three gates, ALL required:
  //   1. Title token Jaccard ≥ TITLE_SIMILARITY_THRESHOLD (with trivial
  //      stemming so "payment"/"payments" count as the same token).
  //   2. ≥1 shared party.
  //   3. Dates within MAX_GROUPING_DATE_DAYS (blocks an Aug MRI from
  //      grouping with a Nov MRI just because both are titled "MRI").
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (sharedPartyCount(events[i], events[j]) < 1) continue;
      if (jaccard(tokens[i], tokens[j]) < TITLE_SIMILARITY_THRESHOLD) continue;
      if (daysBetween(events[i].date, events[j].date) > MAX_GROUPING_DATE_DAYS) continue;
      uf.union(i, j);
    }
  }

  const groupsByRoot = new Map<number, number[]>();
  for (let i = 0; i < events.length; i++) {
    const root = uf.find(i);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root)!.push(i);
  }

  const result: EventGroup[] = [];
  for (const [, indices] of groupsByRoot) {
    const groupEvents = indices.map((i) => events[i]);
    const primary = [...groupEvents].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.date.localeCompare(b.date);
    })[0];

    const dates = new Set(groupEvents.map((e) => e.date));
    const allSources = groupEvents.flatMap((e) => e.sources);
    const needsReview = groupEvents.some(
      (e) => e.confidence < REVIEW_CONFIDENCE_THRESHOLD || e.date_precision === "approximate",
    );
    const contradictions = detectContradictions(groupEvents);

    result.push({
      id: primary.id,
      events: groupEvents.sort((a, b) => a.date.localeCompare(b.date)),
      primary,
      allSources,
      // Duplicate = multi-event group with no contradictions at all.
      isDuplicate: groupEvents.length > 1 && dates.size === 1 && contradictions.length === 0,
      isConflict: contradictions.length > 0,
      needsReview,
      contradictions,
    });
  }

  return result.sort((a, b) => a.primary.date.localeCompare(b.primary.date));
}

// Detectors are exported individually so a future test runner (vitest)
// can exercise each kind on synthetic event groups. Adding the runner was
// deferred to keep this phase from sprouting a new build dep.
