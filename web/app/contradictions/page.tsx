import Link from "next/link";

import { listDocuments, listEvents } from "@/lib/api";
import { formatEventDate, precisionStyle } from "@/lib/dates";
import { groupEvents } from "@/lib/grouping";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  date: "Date conflict",
  role: "Role conflict",
  description: "Account differs",
};

export default async function ContradictionsPage() {
  const [events, docs] = await Promise.all([listEvents(), listDocuments()]);
  const documentNames = Object.fromEntries(docs.map((d) => [d.id, d.filename]));
  const groups = groupEvents(events).filter((g) => g.contradictions.length > 0);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contradictions</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Events grouped from multiple sources that disagree on date, role, or substantive
            account. Oldest first.
          </p>
        </div>
        <Link
          href="/timeline"
          className="text-xs text-sky-700 hover:underline"
        >
          Back to timeline
        </Link>
      </header>

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-6 py-16 text-center text-sm text-neutral-500">
          No contradictions in the current case. The grouping heuristic looks for events that
          share a party and a similar title, then checks for disagreements on date, party role,
          or substantive description.
        </p>
      ) : (
        <ul className="space-y-4">
          {groups.map((group) => {
            const style = precisionStyle(group.primary.date_precision);
            return (
              <li
                key={group.id}
                className="rounded-lg border border-red-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${style.containerClass}`}
                  >
                    {style.label ? (
                      <span className="mr-1 opacity-70">{style.label}</span>
                    ) : null}
                    {formatEventDate(group.primary.date, group.primary.date_precision)}
                  </span>
                  {group.contradictions.map((c) => (
                    <span
                      key={c.kind}
                      className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-800"
                    >
                      {KIND_LABEL[c.kind]}
                    </span>
                  ))}
                </div>

                <h2 className="text-sm font-semibold text-neutral-900">{group.primary.title}</h2>

                <ul className="mt-3 space-y-1 text-sm text-neutral-700">
                  {group.contradictions.map((c) => (
                    <li key={c.kind} className="leading-relaxed">
                      <span className="font-medium text-red-700">{KIND_LABEL[c.kind]}: </span>
                      {c.summary}
                    </li>
                  ))}
                </ul>

                <div className="mt-3 border-t border-neutral-100 pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Sources ({group.allSources.length})
                  </p>
                  <ul className="mt-1 space-y-1 text-xs text-neutral-600">
                    {group.events.map((e) =>
                      e.sources.map((s) => (
                        <li key={s.id}>
                          <span className="font-medium text-neutral-800">
                            {formatEventDate(e.date, e.date_precision)}
                          </span>
                          <span className="mx-1 text-neutral-400">·</span>
                          <Link
                            href={`/documents/${s.document_id}/view?page=${s.page}&start=${s.char_start}&end=${s.char_end}`}
                            className="text-sky-700 hover:underline"
                          >
                            {documentNames[s.document_id] ?? s.document_id} (page {s.page})
                          </Link>
                          <span className="ml-2 italic text-neutral-500">
                            “{s.quote.length > 100 ? s.quote.slice(0, 100) + "..." : s.quote}”
                          </span>
                        </li>
                      )),
                    )}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
