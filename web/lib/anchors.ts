// Pull the dateful fragment out of a source quote, so a card can show
// "because '<anchor>'" without making the user open the drawer.
//
// The patterns are intentionally conservative: when nothing matches, we
// fall back to a short head of the quote rather than guessing. The
// fragment is purely a UI affordance; the persisted source quote is still
// the ground truth.

import type { DatePrecision } from "@shared/types";

const MONTHS =
  "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";

// Helper: trim whitespace + trailing punctuation that often slips in
// when the regex hits a sentence boundary.
function trim(s: string): string {
  return s.replace(/[\s,;:.()]+$/g, "").trim();
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return trim(m[0]);
  }
  return null;
}

const EXACT_PATTERNS = [
  // "on March 5, 2024", "On March 5, 2024"
  new RegExp(`\\bon\\s+${MONTHS}\\s+\\d{1,2},?\\s+\\d{4}\\b`, "i"),
  // "March 5, 2024"
  new RegExp(`\\b${MONTHS}\\s+\\d{1,2},?\\s+\\d{4}\\b`, "i"),
  // "March 5" without year
  new RegExp(`\\b${MONTHS}\\s+\\d{1,2}\\b`, "i"),
];

const ON_OR_ABOUT_PATTERNS = [
  // "on or about March 5, 2024" / "around March 5"
  new RegExp(`\\b(?:on or about|around|approximately|circa)\\s+${MONTHS}\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, "i"),
  ...EXACT_PATTERNS,
];

const APPROXIMATE_PATTERNS = [
  // "in early September 2023", "late March 2024"
  new RegExp(`\\b(?:in\\s+)?(?:early|mid|late)\\s+${MONTHS}\\s+\\d{4}\\b`, "i"),
  // "in March 2024" / "March 2024"
  new RegExp(`\\b(?:in\\s+)?${MONTHS}\\s+\\d{4}\\b`, "i"),
  // "spring 2024"
  /\b(spring|summer|fall|autumn|winter)\s+\d{4}\b/i,
];

const RANGE_PATTERNS = [
  // "from April 1, 2023 to April 30, 2023"
  new RegExp(`\\bfrom\\s+${MONTHS}\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\s+to\\s+${MONTHS}\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, "i"),
  // "April 1 to April 30, 2023"
  new RegExp(`\\b${MONTHS}\\s+\\d{1,2}\\s+to\\s+${MONTHS}\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, "i"),
];

const MAX_FALLBACK_CHARS = 70;

export function dateAnchor(quote: string, precision: DatePrecision): string {
  if (!quote) return "";
  const patterns =
    precision === "exact"
      ? EXACT_PATTERNS
      : precision === "on_or_about"
        ? ON_OR_ABOUT_PATTERNS
        : precision === "approximate"
          ? APPROXIMATE_PATTERNS
          : RANGE_PATTERNS;
  const match = firstMatch(quote, patterns);
  if (match) return match;
  // Fallback: short head of the quote so we still show *something*.
  const head = quote.trim();
  return head.length > MAX_FALLBACK_CHARS ? head.slice(0, MAX_FALLBACK_CHARS) + "..." : head;
}
