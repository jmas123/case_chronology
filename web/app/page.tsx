import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Case Chronology Builder</h1>
      <p className="mt-3 text-base text-neutral-700">
        Upload legal documents. Get back a verifiable case timeline. Every event traces to a quote,
        page, and document.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/documents"
          className="inline-flex items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Documents
        </Link>
        <Link
          href="/timeline"
          className="inline-flex items-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Timeline
        </Link>
        <Link
          href="/contradictions"
          className="inline-flex items-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Contradictions
        </Link>
      </div>
      <p className="mt-8 text-sm text-neutral-500">
        Phase 3: timeline. Source attribution drawer lands in Phase 4. See ROADMAP.md.
      </p>
    </main>
  );
}
