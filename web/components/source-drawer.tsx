"use client";

import { useEffect, useRef } from "react";

import type { Event, Source } from "@shared/types";
import type { EventGroup } from "@/lib/grouping";
import { formatEventDate, precisionStyle } from "@/lib/dates";

interface SourceDrawerProps {
  group: EventGroup | null;
  documentNames: Record<string, string>;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

function SourceBlock({
  source,
  filename,
}: {
  source: Source;
  filename: string;
}) {
  const viewerHref = `/documents/${source.document_id}/view?page=${source.page}&start=${source.char_start}&end=${source.char_end}`;
  return (
    <li className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-medium text-neutral-900">{filename}</p>
        <p className="shrink-0 text-xs text-neutral-500">page {source.page}</p>
      </div>
      <blockquote className="mt-2 border-l-2 border-neutral-300 pl-3 text-sm italic text-neutral-700">
        “{source.quote}”
      </blockquote>
      <a
        href={viewerHref}
        className="mt-2 inline-block text-xs font-medium text-sky-700 hover:underline"
      >
        View in context →
      </a>
    </li>
  );
}

function PerEventSources({
  event,
  documentNames,
}: {
  event: Event;
  documentNames: Record<string, string>;
}) {
  const dateStyle = precisionStyle(event.date_precision);
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${dateStyle.containerClass}`}
        >
          {dateStyle.label ? <span className="mr-1 opacity-70">{dateStyle.label}</span> : null}
          {formatEventDate(event.date, event.date_precision)}
        </span>
        <span className="text-xs text-neutral-500">
          conf {event.confidence.toFixed(2)}
        </span>
      </div>
      <ul className="space-y-2">
        {event.sources.map((src) => (
          <SourceBlock
            key={src.id}
            source={src}
            filename={documentNames[src.document_id] ?? "(unknown document)"}
          />
        ))}
      </ul>
    </div>
  );
}

export function SourceDrawer({ group, documentNames, onClose, triggerRef }: SourceDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!group) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [group, onClose]);

  useEffect(() => {
    if (group) return;
    triggerRef.current?.focus();
  }, [group, triggerRef]);

  if (!group) return null;

  const { primary } = group;
  const dateStyle = precisionStyle(primary.date_precision);
  const isGrouped = group.events.length > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-drawer-title"
      className="fixed inset-0 z-50"
    >
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
        tabIndex={-1}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5">
          <div>
            <span
              className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${dateStyle.containerClass}`}
            >
              {dateStyle.label ? (
                <span className="mr-1 opacity-70">{dateStyle.label}</span>
              ) : null}
              {formatEventDate(primary.date, primary.date_precision)}
            </span>
            <h2 id="source-drawer-title" className="mt-2 text-base font-semibold text-neutral-900">
              {primary.title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {group.isConflict ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  Date conflict across {group.events.length} sources
                </span>
              ) : null}
              {group.isDuplicate ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  {group.events.length} matching mentions
                </span>
              ) : null}
              {group.needsReview ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  Needs review
                </span>
              ) : null}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ×
            </span>
          </button>
        </header>

        <div className="px-6 py-4 text-sm text-neutral-700">
          <p>{primary.description}</p>
          <dl className="mt-4 grid grid-cols-3 gap-y-2 text-xs">
            <dt className="text-neutral-500">Event type</dt>
            <dd className="col-span-2 text-neutral-800">{primary.event_type}</dd>
            <dt className="text-neutral-500">Confidence</dt>
            <dd className="col-span-2 text-neutral-800">
              {primary.confidence.toFixed(2)}
              <span className="ml-2 text-neutral-500">{primary.confidence_rationale}</span>
            </dd>
            {primary.parties.length > 0 ? (
              <>
                <dt className="text-neutral-500">Parties</dt>
                <dd className="col-span-2 text-neutral-800">
                  {primary.parties.map((p) => (
                    <span key={p.id} className="mr-2 inline-block">
                      {p.name}
                      {p.role_in_event ? (
                        <span className="ml-1 text-neutral-500">· {p.role_in_event}</span>
                      ) : null}
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </div>

        <section className="border-t border-neutral-200 px-6 py-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
            {isGrouped
              ? `${group.allSources.length} sources across ${group.events.length} mentions`
              : group.allSources.length === 1
                ? "Source"
                : `${group.allSources.length} sources`}
          </h3>
          {isGrouped ? (
            <div className="space-y-3">
              {group.events.map((event) => (
                <PerEventSources
                  key={event.id}
                  event={event}
                  documentNames={documentNames}
                />
              ))}
            </div>
          ) : (
            <ul className="space-y-2">
              {primary.sources.map((src) => (
                <SourceBlock
                  key={src.id}
                  source={src}
                  filename={documentNames[src.document_id] ?? "(unknown document)"}
                />
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
