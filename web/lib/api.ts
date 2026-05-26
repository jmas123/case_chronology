// Thin client over the FastAPI backend. Reads NEXT_PUBLIC_API_BASE_URL,
// falls back to localhost:8001 (the project default port, see .env.example).

import type {
  DocumentSummary,
  Event,
  ExtractResponse,
  UploadDocumentResponse,
} from "@shared/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8001";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
    return JSON.stringify(body);
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const response = await fetch(`${API_BASE_URL}/documents`, { cache: "no-store" });
  if (!response.ok) {
    throw new ApiError(await parseErrorDetail(response), response.status);
  }
  return response.json();
}

export async function listEvents(): Promise<Event[]> {
  const response = await fetch(`${API_BASE_URL}/events`, { cache: "no-store" });
  if (!response.ok) {
    throw new ApiError(await parseErrorDetail(response), response.status);
  }
  return response.json();
}

export async function getDocument(
  documentId: string,
): Promise<import("@shared/types").Document> {
  const response = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(await parseErrorDetail(response), response.status);
  }
  return response.json();
}

export async function uploadDocument(file: File): Promise<UploadDocumentResponse> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE_URL}/documents`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new ApiError(await parseErrorDetail(response), response.status);
  }
  return response.json();
}

export async function extractDocument(documentId: string): Promise<ExtractResponse> {
  const response = await fetch(`${API_BASE_URL}/documents/${documentId}/extract`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new ApiError(await parseErrorDetail(response), response.status);
  }
  return response.json();
}
