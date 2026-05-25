"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { DocumentSummary, Event } from "@shared/types";
import { ApiError, listDocuments, listEvents } from "@/lib/api";
import { formatEventDate, precisionStyle } from "@/lib/dates";
import { groupEvents, type EventGroup } from "@/lib/grouping";

type LoadState = "loading" | "ready" | "error";

const PRESETS = [
  { years: 1, label: "1 yr" },
  { years: 2, label: "2 yrs" },
  { years: 3, label: "3 yrs" },
  { years: 4, label: "4 yrs" },
] as const;

interface Row {
  group: EventGroup;
  deadline: Date;
  daysRemaining: number;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function parseEventDate(event: Event): Date {
  // For ranges use the END (worst-case latest accrual). Otherwise use the date.
  const raw = event.date.includes("/") ? event.date.split("/")[1] : event.date;
  return new Date(raw + "T00:00:00Z");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rowTone(daysRemaining: number): { row: string; text: string; label: string } {
  if (daysRemaining < 0)
    return {
      row: "bg-red-50",
      text: "text-red-700",
      label: `${Math.abs(daysRemaining)} d past`,
    };
  if (daysRemaining <= 90)
    return {
      row: "bg-amber-50",
      text: "text-amber-800",
      label: `${daysRemaining} d left`,
    };
  return {
    row: "bg-white",
    text: "text-neutral-700",
    label: `${daysRemaining} d left`,
  };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCSV(filename: string, rows: Row[], documentNames: Record<string, string>) {
  const header = ["title", "primary_date", "deadline", "days_remaining", "sources"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const sources = r.group.allSources
      .map((s) => `${documentNames[s.document_id] ?? s.document_id} p.${s.page}`)
      .join("; ");
    lines.push(
      [
        csvEscape(r.group.primary.title),
        formatEventDate(r.group.primary.date, r.group.primary.date_precision),
        formatDate(r.deadline),
        String(r.daysRemaining),
        csvEscape(sources),
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function SolPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const [windowYears, setWindowYears] = useState<number>(4);
  const [customMode, setCustomMode] = useState(false);
  const [hideFar, setHideFar] = useState(true);

  const refresh = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [eventsData, docsData] = await Promise.all([listEvents(), listDocuments()]);
      setEvents(eventsData);
      setDocs(docsData);
      setState("ready");
    } catch (err) {
      setState("error");
      setError(
        err instanceof ApiError
          ? `${err.message} (${err.status})`
          : err instanceof Error
            ? err.message
            : "Failed to load events.",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const documentNames = useMemo(
    () => Object.fromEntries(docs.map((d) => [d.id, d.filename])),
    [docs],
  );

  const allRows: Row[] = useMemo(() => {
    if (state !== "ready") return [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return groupEvents(events)
      .map((g) => {
        const primaryDate = parseEventDate(g.primary);
        const deadline = addYears(primaryDate, windowYears);
        const daysRemaining = daysBetween(deadline, today);
        return { group: g, deadline, daysRemaining };
      })
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [events, state, windowYears]);

  const visibleRows = useMemo(
    () => (hideFar ? allRows.filter((r) => r.daysRemaining <= 365) : allRows),
    [allRows, hideFar],
  );

  const hiddenCount = allRows.length - visibleRows.length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Statute of limitations report</h1>
        <p className="mt-2 text-sm text-neutral-600">
          For each event in the chronology, the deadline column projects{" "}
          <span className="font-medium">today + selected window</span> from the event date. Use the
          range past/within 90 days/later as a planning aid only.
        </p>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Not legal advice. The window must be set per claim type and jurisdiction. This tool is a
          planning prompt, not a substitute for confirming the actual limitations period.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs">
        <span className="text-neutral-500">Window:</span>
        {PRESETS.map((p) => (
          <button
            key={p.years}
            type="button"
            onClick={() => {
              setCustomMode(false);
              setWindowYears(p.years);
            }}
            className={`rounded-md border px-3 py-1.5 font-medium ${
              !customMode && windowYears === p.years
                ? "border-sky-500 bg-sky-50 text-sky-800"
                : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            {p.label}
          </button>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={customMode}
            onChange={(e) => setCustomMode(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span className="text-neutral-700">Custom</span>
        </label>
        {customMode ? (
          <input
            type="number"
            min={1}
            max={20}
            value={windowYears}
            onChange={(e) => setWindowYears(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-neutral-800"
          />
        ) : null}
        <span className="text-neutral-500">years</span>

        <span className="mx-2 h-4 w-px bg-neutral-300" />

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hideFar}
            onChange={(e) => setHideFar(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span className="text-neutral-700">Hide rows more than a year out</span>
        </label>

        <button
          type="button"
          onClick={() => downloadCSV(`sol-report-${windowYears}y.csv`, visibleRows, documentNames)}
          disabled={visibleRows.length === 0}
          className="ml-auto rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {state === "loading" ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : null}

      {state === "error" ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Could not load events.</p>
          <p className="mt-1">{error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-2 text-sm font-medium text-red-800 underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      {state === "ready" && allRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-6 py-16 text-center text-sm text-neutral-500">
          No events yet. Upload a document and run extraction.
        </p>
      ) : null}

      {state === "ready" && allRows.length > 0 && visibleRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500">
          No deadlines within one year. Uncheck &ldquo;Hide rows more than a year out&rdquo; to see
          all {allRows.length} events.
        </p>
      ) : null}

      {state === "ready" && visibleRows.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-neutral-500">
            Showing {visibleRows.length} of {allRows.length} events
            {hiddenCount > 0 ? ` (${hiddenCount} hidden as more than a year out)` : ""}.
          </p>
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Event</th>
                  <th className="px-4 py-2 text-left font-medium">Primary date</th>
                  <th className="px-4 py-2 text-left font-medium">Deadline</th>
                  <th className="px-4 py-2 text-right font-medium">Days remaining</th>
                  <th className="px-4 py-2 text-left font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {visibleRows.map(({ group, deadline, daysRemaining }) => {
                  const tone = rowTone(daysRemaining);
                  const style = precisionStyle(group.primary.date_precision);
                  const firstSource = group.allSources[0];
                  const docName = firstSource
                    ? documentNames[firstSource.document_id] ?? firstSource.document_id
                    : null;
                  return (
                    <tr key={group.id} className={tone.row}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-neutral-900">{group.primary.title}</p>
                        <p className="mt-1 text-xs text-neutral-500">{group.primary.event_type}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${style.containerClass}`}
                        >
                          {style.label ? (
                            <span className="mr-1 opacity-70">{style.label}</span>
                          ) : null}
                          {formatEventDate(group.primary.date, group.primary.date_precision)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs text-neutral-700">
                        {formatDate(deadline)}
                      </td>
                      <td className={`px-4 py-3 text-right align-top font-medium ${tone.text}`}>
                        {tone.label}
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        {firstSource ? (
                          <a
                            href={`/documents/${firstSource.document_id}/view?page=${firstSource.page}&start=${firstSource.char_start}&end=${firstSource.char_end}`}
                            className="text-sky-700 hover:underline"
                          >
                            {docName} (p.{firstSource.page})
                          </a>
                        ) : (
                          <span className="text-neutral-400">no source</span>
                        )}
                        {group.allSources.length > 1 ? (
                          <span className="ml-1 text-neutral-400">
                            +{group.allSources.length - 1}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}
