"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DocumentSummary, ExtractResponse } from "@shared/types";
import { ApiError, extractDocument, listDocuments, uploadDocument } from "@/lib/api";

type ExtractState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: ExtractResponse }
  | { status: "error"; message: string };

type LoadState = "loading" | "ready" | "error";

const ACCEPT = ".pdf,.docx,.txt";

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [extractStates, setExtractStates] = useState<Record<string, ExtractState>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const runExtract = async (documentId: string) => {
    setExtractStates((prev) => ({ ...prev, [documentId]: { status: "running" } }));
    try {
      const result = await extractDocument(documentId);
      setExtractStates((prev) => ({
        ...prev,
        [documentId]: { status: "done", result },
      }));
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.message} (${err.status})`
          : err instanceof Error
            ? err.message
            : "Extraction failed.";
      setExtractStates((prev) => ({
        ...prev,
        [documentId]: { status: "error", message },
      }));
    }
  };

  const refresh = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const items = await listDocuments();
      setDocs(items);
      setLoadState("ready");
    } catch (err) {
      setLoadState("error");
      setLoadError(err instanceof Error ? err.message : "Failed to load documents.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setWarning(null);
    try {
      const result = await uploadDocument(file);
      setWarning(result.warning);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setUploadError(err.message);
      } else {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Upload PDF, .docx, or .txt files, then click Extract to pull dated events.
          </p>
        </div>
        <a
          href="/timeline"
          className="inline-flex items-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          View timeline
        </a>
      </header>

      <section className="mb-8 rounded-lg border border-neutral-200 p-5">
        <label className="block text-sm font-medium text-neutral-800">
          Upload a document
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          Accepted: .pdf, .docx, .txt. Max 25 MB. Scanned PDFs without a text layer are
          accepted but will not produce events.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          onChange={onFileChange}
          disabled={uploading}
          className="mt-3 block w-full text-sm text-neutral-700 file:mr-4 file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800 disabled:opacity-50"
        />
        {uploading ? (
          <p className="mt-3 text-sm text-neutral-500">Uploading and extracting text...</p>
        ) : null}
        {uploadError ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {uploadError}
          </p>
        ) : null}
        {warning ? (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {warning}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Uploaded documents
        </h2>

        {loadState === "loading" ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : null}

        {loadState === "error" ? (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">Could not load documents.</p>
            <p className="mt-1">{loadError}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2 text-sm font-medium text-red-800 underline"
            >
              Retry
            </button>
          </div>
        ) : null}

        {loadState === "ready" && docs.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
            No documents yet. Upload one to get started.
          </p>
        ) : null}

        {loadState === "ready" && docs.length > 0 ? (
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
            {docs.map((doc) => {
              const extract = extractStates[doc.id] ?? { status: "idle" };
              const running = extract.status === "running";
              return (
                <li
                  key={doc.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {doc.filename}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {doc.type.toUpperCase()} · {doc.page_count}{" "}
                      {doc.page_count === 1 ? "page" : "pages"} · uploaded{" "}
                      {formatUploadedAt(doc.uploaded_at)}
                    </p>
                    {extract.status === "done" ? (
                      <p className="mt-1 text-xs text-emerald-700">
                        Extracted {extract.result.events_persisted}{" "}
                        {extract.result.events_persisted === 1 ? "event" : "events"}
                        {extract.result.rejected_bad_quote > 0
                          ? ` · ${extract.result.rejected_bad_quote} rejected for bad quote`
                          : ""}
                      </p>
                    ) : null}
                    {extract.status === "error" ? (
                      <p className="mt-1 text-xs text-red-700">{extract.message}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <code className="text-xs text-neutral-400">{doc.id.slice(0, 8)}</code>
                    <button
                      type="button"
                      onClick={() => void runExtract(doc.id)}
                      disabled={running}
                      className="inline-flex items-center rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {running
                        ? "Extracting..."
                        : extract.status === "done"
                          ? "Re-extract"
                          : "Extract"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
