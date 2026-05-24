"use client";

import type { DocumentSummary } from "@shared/types";
import type { Filters } from "@/lib/filters";
import { EMPTY_FILTERS, filtersAreEmpty } from "@/lib/filters";

interface FilterBarProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  partyOptions: Array<{ id: string; name: string }>;
  documentOptions: DocumentSummary[];
  eventTypeOptions: string[];
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const summary =
    selected.length === 0
      ? `All ${label.toLowerCase()}`
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.label ?? `1 selected`
        : `${selected.length} selected`;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  return (
    <details className="group relative">
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${
          selected.length > 0
            ? "border-sky-500 bg-sky-50 text-sky-800"
            : "border-neutral-300 bg-white text-neutral-700"
        }`}
      >
        <span className="text-neutral-500">{label}:</span>
        <span>{summary}</span>
        <span className="text-neutral-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
        {options.length === 0 ? (
          <p className="px-2 py-1 text-xs text-neutral-500">No options yet.</p>
        ) : (
          <ul className="space-y-1">
            {options.map((opt) => (
              <li key={opt.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-neutral-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.id)}
                    onChange={() => toggle(opt.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="flex-1 truncate text-neutral-800">{opt.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function FilterBar({
  filters,
  onChange,
  partyOptions,
  documentOptions,
  eventTypeOptions,
}: FilterBarProps) {
  const partyOpts = partyOptions.map((p) => ({ id: p.id, label: p.name }));
  const docOpts = documentOptions.map((d) => ({ id: d.id, label: d.filename }));
  const typeOpts = eventTypeOptions.map((t) => ({ id: t, label: t }));

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <MultiSelect
        label="Party"
        options={partyOpts}
        selected={filters.partyIds}
        onChange={(partyIds) => onChange({ ...filters, partyIds })}
      />
      <MultiSelect
        label="Document"
        options={docOpts}
        selected={filters.documentIds}
        onChange={(documentIds) => onChange({ ...filters, documentIds })}
      />
      <MultiSelect
        label="Type"
        options={typeOpts}
        selected={filters.eventTypes}
        onChange={(eventTypes) => onChange({ ...filters, eventTypes })}
      />

      <div className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs">
        <span className="text-neutral-500">From</span>
        <input
          type="date"
          value={filters.dateFrom ?? ""}
          onChange={(e) =>
            onChange({ ...filters, dateFrom: e.target.value || null })
          }
          className="bg-transparent text-neutral-800 outline-none"
        />
      </div>
      <div className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs">
        <span className="text-neutral-500">To</span>
        <input
          type="date"
          value={filters.dateTo ?? ""}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value || null })}
          className="bg-transparent text-neutral-800 outline-none"
        />
      </div>

      <div className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs">
        <span className="text-neutral-500">Min confidence</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={filters.minConfidence}
          onChange={(e) =>
            onChange({ ...filters, minConfidence: Number(e.target.value) })
          }
          className="w-24"
        />
        <span className="w-8 tabular-nums text-neutral-700">
          {filters.minConfidence.toFixed(2)}
        </span>
      </div>

      {!filtersAreEmpty(filters) ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="ml-auto rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
