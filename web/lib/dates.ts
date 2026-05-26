// Render an event's date by its precision. Pure functions, no React.
//
// exact         "Mar 5, 2024"
// on_or_about   "on or about Mar 5, 2024"   (also expose a tilde prefix variant)
// range         "Mar 5 to Mar 12, 2024"
// approximate   "[ March 2024 ]"            (soft bracket = visual fuzziness)

import type { DatePrecision } from "@shared/types";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface ParsedDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

function parseISODate(s: string): ParsedDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function formatExact(d: ParsedDate): string {
  return `${MONTHS_SHORT[d.month - 1]} ${d.day}, ${d.year}`;
}

function formatMonthYear(d: ParsedDate): string {
  return `${MONTHS_LONG[d.month - 1]} ${d.year}`;
}

function formatRange(date: string): string {
  const [startStr, endStr] = date.split("/");
  const start = parseISODate(startStr);
  const end = endStr ? parseISODate(endStr) : null;
  if (!start) return date;
  if (!end) return formatExact(start);
  // Same year: "Mar 5 to Mar 12, 2024". Different year: full both sides.
  if (start.year === end.year) {
    return `${MONTHS_SHORT[start.month - 1]} ${start.day} to ${MONTHS_SHORT[end.month - 1]} ${end.day}, ${end.year}`;
  }
  return `${formatExact(start)} to ${formatExact(end)}`;
}

export function formatEventDate(date: string, precision: DatePrecision): string {
  if (precision === "range") return formatRange(date);

  const parsed = parseISODate(date);
  if (!parsed) return date; // Fall back to raw if anything is off.

  switch (precision) {
    case "exact":
      return formatExact(parsed);
    case "on_or_about":
      return `on or about ${formatExact(parsed)}`;
    case "approximate":
      return `[ ${formatMonthYear(parsed)} ]`;
  }
}

// Returns a Tailwind class slug for the visual treatment of the date
// chip. Lets the card render different styles per precision.
export function precisionStyle(precision: DatePrecision): {
  containerClass: string;
  label: string | null;
} {
  switch (precision) {
    case "exact":
      return { containerClass: "bg-neutral-100 text-neutral-900", label: null };
    case "on_or_about":
      return { containerClass: "bg-amber-50 text-amber-900", label: "~" };
    case "range":
      return { containerClass: "bg-sky-50 text-sky-900", label: "range" };
    case "approximate":
      return {
        containerClass: "bg-violet-50 text-violet-900 italic",
        label: "approx",
      };
  }
}
