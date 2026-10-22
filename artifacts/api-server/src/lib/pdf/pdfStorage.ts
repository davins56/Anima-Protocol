/**
 * Where original PDF bytes live.
 *
 * Primary: Supabase Storage private bucket `companion-documents` (override with
 * SUPABASE_PDF_BUCKET) via REST with the service-role key, exactly like
 * lib/photo/photoStorage.ts. Object path `{user_id}/{document_id}.pdf`; the
 * first segment is the owner, which is what the storage.objects RLS policies
 * in 20261022210000_pdf_pipeline.sql check. Browsers never get the key; they
 * read through GET /api/pdfs/:id/file (Clerk-authenticated, owner only).
 *
 * Fallback (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset, e.g. local dev or
 * a database-only deploy): Postgres `pdf_file_parts`, 512 KiB per row, which
 * is what the app used before the pipeline existed. Rows with neither are
 * legacy and simply have no downloadable original.
 */
import { getPool } from "@workspace/db";
import { normalizeApiKey } from "../openaiClient";
import { PDF_FILE_PART_BYTES } from "./limits";

export const PDF_BUCKET = (): string =>
  process.env.SUPABASE_PDF_BUCKET?.trim() || "companion-documents";

export type PdfObjectRef = {
  /** NULL = Postgres pdf_file_parts. */
  bucket: string | null;
  path: string | null;
};

export type PdfObjectKey = { userId: string; documentId: string } & PdfObjectRef;

export interface PdfBlobStore {
  readonly kind: "supabase" | "postgres";
  put(args: { userId: string; documentId: string; bytes: Uint8Array }): Promise<PdfObjectRef>;
  /** Null when the object is gone (or a legacy row never stored bytes). */
  get(key: PdfObjectKey): Promise<Uint8Array | null>;
  /** Best-effort and idempotent: removing a missing object is not an error. */
  remove(key: PdfObjectKey): Promise<void>;
}

function supabaseUrl(): string | null {
  const raw = process.env.SUPABASE_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

function serviceKey(): string | null {
  return normalizeApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasSupabasePdfStorage(): boolean {
  return Boolean(supabaseUrl() && serviceKey());
}

function safeSegment(v: string): string {
  return String(v).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128) || "x";
}

export function pdfObjectPath(userId: string, documentId: string): string {
  return `${safeSegment(userId)}/${safeSegment(documentId)}.pdf`;
}

function storageError(message: string, status = 502): Error {
  return Object.assign(new Error(message), { status, code: "storage_error" });
}

type FetchLike = typeof fetch;

export function supabasePdfStore(fetchImpl: FetchLike = fetch): PdfBlobStore {
  const headers = (): Record<string, string> => {
    const key = serviceKey();
    if (!key) throw storageError("Supabase storage is not configured.", 503);
    return { Authorization: `Bearer ${key}`, apikey: key };
  };
  const objectUrl = (bucket: string, path: string) =>
    `${supabaseUrl()}/storage/v1/object/${encodeURIComponent(bucket)}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  return {
    kind: "supabase",
    async put({ userId, documentId, bytes }) {
      const bucket = PDF_BUCKET();
      const path = pdfObjectPath(userId, documentId);
      // x-upsert: a retried upload of the same document overwrites, never duplicates.
      const res = await fetchImpl(objectUrl(bucket, path), {
        method: "POST",
        headers: {
          ...headers(),
          "Content-Type": "application/pdf",
          "x-upsert": "true",
          "cache-control": "private, max-age=0",
        },
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw storageError(`Supabase storage upload failed (${res.status}): ${text.slice(0, 200)}`);
      }
      return { bucket, path };
    },
    async get({ bucket, path }) {
      if (!bucket || !path) return null;
      const res = await fetchImpl(objectUrl(bucket, path), { headers: headers() });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw storageError(`Supabase storage read failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove({ bucket, path }) {
      if (!bucket || !path) return;
      const res = await fetchImpl(`${supabaseUrl()}/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: "DELETE",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [path] }),
      });
      if (!res.ok && res.status !== 404) {
        throw storageError(`Supabase storage delete failed (${res.status})`);
      }
    },
  };
}

export function postgresPdfStore(): PdfBlobStore {
  return {
    kind: "postgres",
    async put({ userId, documentId, bytes }) {
      const pool = getPool();
      // Idempotent: a retry replaces the parts instead of colliding on the PK.
      await pool.query(`DELETE FROM pdf_file_parts WHERE document_id = $1 AND user_id = $2`, [
        documentId,
        userId,
      ]);
      let index = 0;
      for (let offset = 0; offset < bytes.byteLength; offset += PDF_FILE_PART_BYTES) {
        const slice = bytes.subarray(offset, offset + PDF_FILE_PART_BYTES);
        await pool.query(
          `INSERT INTO pdf_file_parts (document_id, user_id, part_index, data)
           VALUES ($1, $2, $3, decode($4, 'base64'))`,
          [documentId, userId, index, Buffer.from(slice).toString("base64")],
        );
        index += 1;
      }
      return { bucket: null, path: null };
    },
    async get({ userId, documentId }) {
      const { rows } = await getPool().query<{ data_base64: string }>(
        `SELECT replace(encode(data, 'base64'), chr(10), '') AS data_base64
         FROM pdf_file_parts
         WHERE document_id = $1 AND user_id = $2
         ORDER BY part_index ASC`,
        [documentId, userId],
      );
      if (!rows.length) return null;
      return new Uint8Array(
        Buffer.concat(rows.map((row) => Buffer.from(String(row.data_base64 || ""), "base64"))),
      );
    },
    async remove({ userId, documentId }) {
      await getPool().query(`DELETE FROM pdf_file_parts WHERE document_id = $1 AND user_id = $2`, [
        documentId,
        userId,
      ]);
    },
  };
}

/** Store for new uploads. Reads route by the row's own bucket (see storeFor). */
export function defaultPdfBlobStore(): PdfBlobStore {
  return hasSupabasePdfStorage() ? supabasePdfStore() : postgresPdfStore();
}

/** Store that holds an existing row's bytes, whatever the current config is. */
export function storeFor(ref: { bucket: string | null }): PdfBlobStore {
  return ref.bucket ? supabasePdfStore() : postgresPdfStore();
}
