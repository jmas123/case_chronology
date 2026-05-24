import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError, getDocument } from "@/lib/api";

const PAGE_SEP = "\f";

interface ViewerProps {
  params: { id: string };
  searchParams: { page?: string; start?: string; end?: string };
}

function parseIntegerParam(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function HighlightedPage({
  text,
  start,
  end,
}: {
  text: string;
  start: number | null;
  end: number | null;
}) {
  // No highlight requested or invalid range — render plain.
  if (start === null || end === null || start < 0 || end <= start || end > text.length) {
    return <pre className="whitespace-pre-wrap font-mono text-sm text-neutral-800">{text}</pre>;
  }
  return (
    <pre className="whitespace-pre-wrap font-mono text-sm text-neutral-800">
      {text.slice(0, start)}
      <mark
        id="source-highlight"
        className="rounded bg-yellow-200 px-0.5 text-neutral-900"
      >
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </pre>
  );
}

export default async function DocumentViewerPage({ params, searchParams }: ViewerProps) {
  const { id } = params;
  const requestedPage = parseIntegerParam(searchParams.page) ?? 1;
  const start = parseIntegerParam(searchParams.start);
  const end = parseIntegerParam(searchParams.end);

  let doc;
  try {
    doc = await getDocument(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  const pages = doc.raw_text.split(PAGE_SEP);
  const pageIndex = Math.min(Math.max(requestedPage, 1), pages.length) - 1;
  const pageText = pages[pageIndex] ?? "";
  const totalPages = pages.length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <nav className="mb-6 flex items-center justify-between text-sm">
        <Link href="/timeline" className="text-sky-700 hover:underline">
          ← Back to timeline
        </Link>
        <Link href="/documents" className="text-neutral-500 hover:text-neutral-700">
          Documents
        </Link>
      </nav>

      <header className="mb-6 border-b border-neutral-200 pb-4">
        <h1 className="text-xl font-semibold text-neutral-900">{doc.filename}</h1>
        <p className="mt-1 text-xs text-neutral-500">
          {doc.type.toUpperCase()} · page {pageIndex + 1} of {totalPages}
        </p>
      </header>

      {totalPages > 1 ? (
        <div className="mb-4 flex gap-2 text-xs">
          {Array.from({ length: totalPages }).map((_, i) => {
            const p = i + 1;
            const isCurrent = p === pageIndex + 1;
            return (
              <Link
                key={p}
                href={`/documents/${id}/view?page=${p}`}
                className={`rounded-md border px-2 py-1 ${
                  isCurrent
                    ? "border-sky-500 bg-sky-50 text-sky-800"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                Page {p}
              </Link>
            );
          })}
        </div>
      ) : null}

      <article className="rounded-lg border border-neutral-200 bg-white p-6">
        <HighlightedPage text={pageText} start={start} end={end} />
      </article>
    </main>
  );
}
