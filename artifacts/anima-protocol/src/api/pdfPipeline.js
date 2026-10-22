import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "./authBridge";

/**
 * Upload pipeline status (artifacts/api-server/src/lib/pdf/pipeline.ts):
 * uploaded → extracting → chunking → embedding → ready | failed.
 * `embedding` and `ready` are both searchable by the companion.
 */
export const PDF_ACTIVE_STATUSES = ["uploaded", "extracting", "chunking", "embedding"];

export function isPdfActive(file) {
  return Boolean(file && PDF_ACTIVE_STATUSES.includes(file.status));
}

async function request(path, options = {}) {
  const headers = await authHeaders(options.headers);
  const res = await fetch(apiUrl(path), { ...options, headers, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Could not check that PDF.");
    error.code = data.code;
    error.status = res.status;
    throw error;
  }
  return data;
}

/** One document with status. A poll also nudges a stalled pipeline forward. */
export async function getPdfDocument(id) {
  const data = await request(`/pdfs/${encodeURIComponent(id)}`);
  return data?.file || null;
}

/** Re-run a failed document from the stored original. */
export async function retryPdfDocument(id) {
  const data = await request(`/pdfs/${encodeURIComponent(id)}/retry`, { method: "POST" });
  return data?.file || null;
}

/** Chip line for a stored document; null means "show the page count". */
export function pdfStatusLabel(file) {
  if (!file?.status || file.status === "ready") return null;
  switch (file.status) {
    case "uploaded":
      return "Uploaded — waiting to read…";
    case "extracting":
      return "Reading text…";
    case "chunking":
      return "Splitting into passages…";
    case "embedding":
      return "Indexing for recall…";
    case "failed":
      return file.error || "Couldn't read this PDF.";
    default:
      return null;
  }
}
