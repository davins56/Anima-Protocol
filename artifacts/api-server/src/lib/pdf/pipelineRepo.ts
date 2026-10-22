/**
 * Postgres implementation of PdfPipelineRepo. Every statement is scoped by
 * user_id as well as document id. The shared pool only exposes query(), so
 * each multi-row write is a single statement (atomic on its own).
 */
import { getPool } from "@workspace/db";
import { toVectorLiteral } from "../memoryCore/embedder";
import type { PdfChunkDraft } from "./chunk";
import {
  asPdfStatus,
  type PdfPipelineDoc,
  type PdfPipelineRepo,
  type PdfStatus,
  type PdfStatusPatch,
} from "./pipeline";

export const PDF_DOC_COLUMNS = `id, user_id, scope, session_id, character_id, filename, byte_size, page_count,
  chunk_count, created_at, updated_at, status, error, error_code, attempts, content_sha256,
  storage_bucket, storage_path, embedded_chunk_count, embedding_model, processing_started_at, completed_at`;

export type PdfDocRow = {
  id: string;
  user_id: string;
  scope: string;
  session_id: string | null;
  character_id: string | null;
  filename: string;
  byte_size: number | string;
  page_count: number | string;
  chunk_count: number | string;
  created_at: Date | string;
  updated_at?: Date | string | null;
  status?: string | null;
  error?: string | null;
  error_code?: string | null;
  attempts?: number | string | null;
  content_sha256?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  embedded_chunk_count?: number | string | null;
  embedding_model?: string | null;
  processing_started_at?: Date | string | null;
  completed_at?: Date | string | null;
  has_file?: boolean | string | number | null;
};

export function rowToPipelineDoc(row: PdfDocRow): PdfPipelineDoc {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope === "lore" ? "lore" : "chat",
    sessionId: row.session_id,
    characterId: row.character_id,
    filename: row.filename,
    status: asPdfStatus(row.status),
    pageCount: Number(row.page_count) || 0,
    chunkCount: Number(row.chunk_count) || 0,
    embeddedChunkCount: Number(row.embedded_chunk_count) || 0,
    storageBucket: row.storage_bucket ?? null,
    storagePath: row.storage_path ?? null,
    attempts: Number(row.attempts) || 0,
    error: row.error ?? null,
    errorCode: row.error_code ?? null,
  };
}

async function q<T extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query<T>(text, values)).rows;
}

/**
 * `<document>:<attempt>:<index>`. Deterministic within one pipeline run (so a
 * vector insert can key on it), and distinct across runs, which lets
 * replaceChunks delete the old set and insert the new one in one statement
 * without a primary-key collision.
 */
export function chunkId(documentId: string, attempt: number, chunkIndex: number): string {
  return `${documentId}:${attempt}:${chunkIndex}`;
}

export const sqlPdfPipelineRepo: PdfPipelineRepo = {
  async get(documentId, userId) {
    const rows = await q<PdfDocRow>(
      `SELECT ${PDF_DOC_COLUMNS} FROM pdf_documents WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [documentId, userId],
    );
    return rows[0] ? rowToPipelineDoc(rows[0]) : null;
  },

  async claim(documentId, userId, staleMs) {
    const rows = await q<PdfDocRow>(
      `UPDATE pdf_documents
         SET status = 'extracting', attempts = attempts + 1, processing_started_at = now(),
             error = NULL, error_code = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2
         AND (
           status IN ('uploaded', 'failed')
           OR (status IN ('extracting', 'chunking')
               AND COALESCE(processing_started_at, updated_at) < now() - ($3::int * interval '1 millisecond'))
         )
       RETURNING ${PDF_DOC_COLUMNS}`,
      [documentId, userId, Math.max(0, Math.floor(staleMs))],
    );
    return rows[0] ? rowToPipelineDoc(rows[0]) : null;
  },

  async setStatus(documentId, userId, status: PdfStatus, patch: PdfStatusPatch = {}) {
    const sets = ["status = $3", "updated_at = now()"];
    const values: unknown[] = [documentId, userId, status];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (patch.pageCount !== undefined) add("page_count", patch.pageCount);
    if (patch.chunkCount !== undefined) add("chunk_count", patch.chunkCount);
    if (patch.embeddedChunkCount !== undefined) add("embedded_chunk_count", patch.embeddedChunkCount);
    if (patch.embeddingModel !== undefined) add("embedding_model", patch.embeddingModel);
    if (patch.error !== undefined) add("error", patch.error);
    if (patch.errorCode !== undefined) add("error_code", patch.errorCode);
    if (patch.completed) sets.push("completed_at = now()");
    if (status === "failed" || status === "ready") sets.push("processing_started_at = NULL");
    await q(`UPDATE pdf_documents SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`, values);
  },

  async replaceChunks(doc, chunks: PdfChunkDraft[]) {
    // $1 filename, $2 user, $3 document. One statement: the old set (and, by
    // cascade, its vectors) goes and the new set lands atomically.
    const values: unknown[] = [doc.filename, doc.userId, doc.id];
    const rows: string[] = [];
    for (const chunk of chunks) {
      const base = values.length;
      values.push(
        chunkId(doc.id, doc.attempts, chunk.chunkIndex),
        chunk.chunkIndex,
        chunk.pageStart,
        chunk.pageEnd,
        chunk.content,
        chunk.tokenCount,
      );
      rows.push(
        `($${base + 1}::text, $3::text, $2::text, $${base + 2}::int, $${base + 3}::int, $${base + 4}::int, $${base + 5}::text, to_tsvector('english', $1::text || ' ' || $${base + 5}::text), $${base + 6}::int)`,
      );
    }
    await q(
      `WITH cleared AS (
         DELETE FROM pdf_chunks WHERE document_id = $3 AND user_id = $2 RETURNING id
       )
       INSERT INTO pdf_chunks (
         id, document_id, user_id, chunk_index, page_start, page_end, content, search_vector, token_count
       )
       VALUES ${rows.join(", ")}`,
      values,
    );
  },

  async pendingEmbeddingChunks(documentId, userId, limit) {
    return q<{ id: string; content: string }>(
      `SELECT c.id, c.content
       FROM pdf_chunks c
       WHERE c.document_id = $1 AND c.user_id = $2
         AND NOT EXISTS (SELECT 1 FROM pdf_chunk_embeddings e WHERE e.chunk_id = c.id)
       ORDER BY c.chunk_index ASC
       LIMIT $3`,
      [documentId, userId, Math.max(1, limit)],
    );
  },

  async insertEmbeddings(documentId, userId, rows) {
    if (!rows.length) return;
    const values: unknown[] = [documentId, userId];
    const tuples: string[] = [];
    for (const row of rows) {
      const base = values.length;
      values.push(row.chunkId, toVectorLiteral(row.vector), row.model);
      tuples.push(`($${base + 1}::text, $1::text, $2::text, $${base + 2}::vector, $${base + 3}::text)`);
    }
    try {
      await q(
        `INSERT INTO pdf_chunk_embeddings (chunk_id, document_id, user_id, embedding, embedding_model)
         SELECT v.chunk_id, v.document_id, v.user_id, v.embedding, v.embedding_model
         FROM (VALUES ${tuples.join(", ")}) AS v(chunk_id, document_id, user_id, embedding, embedding_model)
         JOIN pdf_chunks c ON c.id = v.chunk_id AND c.user_id = v.user_id
         ON CONFLICT (chunk_id) DO NOTHING`,
        values,
      );
    } catch (error) {
      // A concurrent re-chunk removed these chunks: their vectors are moot.
      if ((error as { code?: string })?.code !== "23503") throw error;
    }
  },

  async countEmbedded(documentId, userId) {
    const rows = await q<{ n: number | string }>(
      `SELECT count(*)::int AS n FROM pdf_chunk_embeddings WHERE document_id = $1 AND user_id = $2`,
      [documentId, userId],
    );
    return Number(rows[0]?.n) || 0;
  },
};
