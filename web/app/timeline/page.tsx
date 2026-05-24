"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { DocumentSummary, Event } from "@shared/types";
import { ApiError, listDocuments, listEvents } from "@/lib/api";
import { SourceDrawer } from "@/components/source-drawer";
import { FilterBar } from "@/components/filter-bar";
import {
  EMPTY_FILTERS,
  applyFilters,
  eventTypeOptionsFromEvents,
  filtersAreEmpty,
  filtersFromURL,
  filtersToSearchString,
  partyOptionsFromEvents,
  type Filters,
} from "@/lib/filters";
import { groupEvents, type EventGroup } from "@/lib/grouping";
import { formatEventDate, precisionStyle } from "@/lib/dates";

type LoadState = "loading" | "ready" | "error";

function confidenceTone(confidence: number): { dot: string; text: string } {
  if (confidence >= 0.8) return { dot: "bg-emerald-500", text: "text-emerald-700" };
  if (confidence >= 0.5) return { dot: "bg-amber-500", text: "text-amber-700" };
  return { dot: "bg-red-500", text: "text-red-700" };
}

interface EventCardProps {
  group: EventGroup;
  onSelect: (group: EventGroup, trigger: HTMLButtonElement) => void;
  isSelected: boolean;
}

function EventCard({ group, onSelect, isSelected }: EventCardProps) {
  const { primary } = group;
  const style = precisionStyle(primary.date_precision);
  const tone = confidenceTone(primary.confidence);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const ringClass = group.isConflict
    ? "border-red-400 ring-1 ring-red-200"
    : group.isDuplicate
      ? "border-emerald-400 ring-1 ring-emerald-200"
      : "border-neutral-200";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => buttonRef.current && onSelect(group, buttonRef.current)}
      aria-haspopup="dialog"
      aria-expanded={isSelected}
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-white p-4 text-left shadow-sm transition hover:border-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        isSelected ? "border-sky-500 ring-2 ring-sky-300" : ringClass
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${style.containerClass}`}
        >
          {style.label ? <span className="mr-1 opacity-70">{style.label}</span> : null}
          {formatEventDate(primary.date, primary.date_precision)}
        </span>
        <span className={`inline-flex items-center gap-1 text-xs ${tone.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          {primary.confidence.toFixed(2)}
        </span>
      </div>

      {group.isConflict || group.isDuplicate || group.needsReview ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {group.isConflict ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-800">
              Conflict ({group.events.length})
            </span>
          ) : null}
          {group.isDuplicate ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
              ×{group.events.length}
            </span>
          ) : null}
          {group.needsReview ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
              Needs review
            </span>
          ) : null}
        </div>
      ) : null}

      <h3 className="mt-3 text-sm font-semibold text-neutral-900">{primary.title}</h3>
      <p className="mt-1 line-clamp-3 text-xs text-neutral-600">{primary.description}</p>

      {primary.parties.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1">
          {primary.parties.map((p) => (
            <li
              key={p.id}
              className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
              title={p.role_in_event ?? undefined}
            >
              {p.name}
              {p.role_in_event ? (
                <span className="ml-1 text-neutral-400">· {p.role_in_event}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex items-center justify-between pt-3 text-[11px] uppercase tracking-wide text-neutral-400">
        <span>{primary.event_type}</span>
        <span>
          {group.allSources.length}{" "}
          {group.allSources.length === 1 ? "source" : "sources"}
        </span>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="flex w-72 shrink-0 animate-pulse flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="h-5 w-24 rounded bg-neutral-200" />
      <div className="h-4 w-3/4 rounded bg-neutral-200" />
      <div className="h-3 w-full rounded bg-neutral-100" />
      <div className="h-3 w-5/6 rounded bg-neutral-100" />
      <div className="mt-3 flex gap-1">
        <div className="h-5 w-16 rounded-full bg-neutral-100" />
        <div className="h-5 w-12 rounded-full bg-neutral-100" />
      </div>
    </div>
  );
}

function TimelineContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [events, setEvents] = useState<Event[]>([]);
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const [selectedGroup, setSelectedGroup] = useState<EventGroup | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Filters live in the URL. Read on mount and any time URL changes.
  const filters: Filters = useMemo(
    () => filtersFromURL(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const updateFilters = useCallback(
    (next: Filters) => {
      const search = filtersToSearchString(next);
      router.replace(search ? `?${search}` : "/timeline", { scroll: false });
    },
    [router],
  );

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
  const partyOptions = useMemo(() => partyOptionsFromEvents(events), [events]);
  const eventTypeOptions = useMemo(() => eventTypeOptionsFromEvents(events), [events]);
  const filteredEvents = useMemo(() => applyFilters(events, filters), [events, filters]);
  const groups = useMemo(() => groupEvents(filteredEvents), [filteredEvents]);

  const handleSelect = (group: EventGroup, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setSelectedGroup(group);
  };

  const hasAnyEvents = events.length > 0;
  const filtersActive = !filtersAreEmpty(filters);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Events extracted from uploaded documents, ordered by date. Click an event to see
            the source quote and document.
          </p>
        </div>
        {state === "ready" ? (
          <p className="text-xs text-neutral-500">
            {filtersActive
              ? `${groups.length} ${groups.length === 1 ? "group" : "groups"} (${filteredEvents.length} of ${events.length} events)`
              : `${groups.length} ${groups.length === 1 ? "group" : "groups"} (${events.length} ${events.length === 1 ? "event" : "events"})`}
          </p>
        ) : null}
      </header>

      {state === "ready" && hasAnyEvents ? (
        <FilterBar
          filters={filters}
          onChange={updateFilters}
          partyOptions={partyOptions}
          documentOptions={docs}
          eventTypeOptions={eventTypeOptions}
        />
      ) : null}

      {state === "loading" ? (
        <div className="flex gap-4 overflow-x-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
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

      {state === "ready" && !hasAnyEvents ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-6 py-16 text-center text-sm text-neutral-500">
          No events yet. Upload a document and run extraction.
        </p>
      ) : null}

      {state === "ready" && hasAnyEvents && groups.length === 0 ? (
        <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-6 py-12 text-center text-sm text-amber-800">
          <p className="font-medium">No events match the current filters.</p>
          <p className="mt-1 text-amber-700">
            Try widening the date range or removing a filter.
          </p>
          <button
            type="button"
            onClick={() => updateFilters(EMPTY_FILTERS)}
            className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
          >
            Clear filters
          </button>
        </div>
      ) : null}

      {state === "ready" && groups.length > 0 ? (
        <div
          className="flex gap-4 overflow-x-auto pb-4"
          role="region"
          aria-label="Case timeline, horizontally scrollable"
        >
          {groups.map((group) => (
            <EventCard
              key={group.id}
              group={group}
              onSelect={handleSelect}
              isSelected={selectedGroup?.id === group.id}
            />
          ))}
        </div>
      ) : null}

      <SourceDrawer
        group={selectedGroup}
        documentNames={documentNames}
        triggerRef={triggerRef}
        onClose={() => setSelectedGroup(null)}
      />
    </main>
  );
}

export default function TimelinePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-6xl px-6 py-12">
          <p className="text-sm text-neutral-500">Loading...</p>
        </main>
      }
    >
      <TimelineContent />
    </Suspense>
  );
}
