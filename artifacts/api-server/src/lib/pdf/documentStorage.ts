/**
 * Optional mirror of original PDF bytes into the private Supabase bucket
 * `companion-documents` ({userId}/{documentId}.pdf, owner-only RLS; see
 * supabase/migrations/20261022260000_document_memory.sql). The Postgres
 * pdf_file_parts copy stays the source of truth; this runs only when
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set and never fails an upload.
 */
import { normalizeApiKey } from "../openaiClient";

export const DOCUMENT_BUCKET = () => process.env.SUPABASE_DOCUMENT_BUCKET?.trim() || "companion-documents";

function base(): string | null {
  const raw = process.env.SUPABASE_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}
function key(): string | null {
  return normalizeApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function documentObjectPath(userId: string, documentId: string): string {
  const seg = (v: string) => String(v).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "x";
  return `${seg(userId)}/${seg(documentId)}.pdf`;
}

export function hasDocumentStorage(): boolean {
  return Boolean(base() && key());
}

export async function mirrorPdfToStorage(userId: string, documentId: string, bytes: Uint8Array): Promise<boolean> {
  if (!hasDocumentStorage()) return false;
  const k = key()!;
  const res = await fetch(`${base()}/storage/v1/object/${DOCUMENT_BUCKET()}/${documentObjectPath(userId, documentId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${k}`, apikey: k, "Content-Type": "application/pdf", "x-upsert": "false" },
    body: bytes as unknown as BodyInit,
  });
  return res.ok;
}

export async function removePdfFromStorage(userId: string, documentId: string): Promise<boolean> {
  if (!hasDocumentStorage()) return false;
  const k = key()!;
  const res = await fetch(`${base()}/storage/v1/object/${DOCUMENT_BUCKET()}/${documentObjectPath(userId, documentId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${k}`, apikey: k },
  });
  return res.ok;
}
