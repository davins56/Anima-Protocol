import { randomUUID } from "crypto";
import {
  CHAT_SESSION,
  ensureSchemaOnce,
  getPool,
  withTransientDbRetry,
} from "@workspace/db";
import { appendMemoryEvent, retractMemory } from "../memoryCore/memoryCore";
import { embedQueryCached, toVectorLiteral } from "../memoryCore/embedder";
import { isMemoryCoreEnabled } from "../memoryCore/sessionContext";
import {
  buildPdfRetrievalSql,
  packPdfContext,
  pdfSearchTerms,
  pdfTsQuery,
  safeEntityId,
  safeEntityIds,
  sanitizePdfFilename,
  type PdfFileSummary,
  type PdfHit,
} from "./context";
import { PdfUploadError } from "./errors";
import { decodePdfBase64, sha256Hex, validatePdfUpload } from "./extract";
import {
  PDF_CONTEXT_MAX_HITS,
  PDF_MAX_BASE64_BYTES,
  PDF_MAX_FILES_PER_CHAT,
  PDF_MAX_FILES_PER_LORE,
  PDF_QUERY_EMBED_TIMEOUT_MS,
  PDF_STALE_PROCESSING_MS,
  PDF_VECTOR_MIN_SIMILARITY,
  pdfMaxBytes,
} from "./limits";
import { defaultPdfBlobStore, storeFor, type PdfBlobStore } from "./pdfStorage";
import {
  asPdfStatus,
  embedPdfTexts,
  embedPendingChunks,
  isMissingRelation,
  pdfEmbedderAvailable,
  pdfEmbedProvider,
  runPdfPipeline,
  type PdfPipelineDeps,
  type PdfPipelineDoc,
  type PdfStatus,
  type PipelineResult,
} from "./pipeline";
import { PDF_DOC_COLUMNS, sqlPdfPipelineRepo, type PdfDocRow } from "./pipelineRepo";

export type PdfScope = "chat" | "lore";

export type PdfDocumentRecord = {
  id: string;
  filename: string;
  scope: PdfScope;
  sessionId: string | null;
  characterId: string | null;
  byteSize: number;
  pageCount: number;
  chunkCount: number;
  /** True when the original bytes are stored (Supabase Storage or pdf_file_parts). */
  hasFile: boolean;
  createdAt: string;
  /** uploaded → extracting → chunking → embedding → ready | failed */
  status: PdfStatus;
  /** User-facing reason when status is failed. */
  error: string | null;
  errorCode: string | null;
  embeddedChunkCount: number;
  /** Ready for full-text recall, vectors still being filled in by the backfill. */
  vectorsPending: boolean;
  updatedAt: string | null;
};

function isMissingPdfTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  return (
    code === "42P01" ||
    /relation ["']?(pdf_documents|pdf_chunks|pdf_file_parts)["']? does not exist/i.test(message) ||
    // A database from before the pipeline columns: ensure-schema adds them.
    (code === "42703" && /column .* does not exist/i.test(message))
  );
}

async function queryRows<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, values);
  return result.rows;
}

async function withPdfTable<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await withTransientDbRetry(run);
  } catch (error) {
    if (!isMissingPdfTable(error)) throw error;
    await ensureSchemaOnce();
    return await withTransientDbRetry(run);
  }
}

function asScope(value: unknown): PdfScope | null {
  return value === "chat" || value === "lore" ? value : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapDocument(row: PdfDocRow): PdfDocumentRecord {
  const scope = asScope(row.scope) ?? "chat";
  const status = asPdfStatus(row.status);
  const chunkCount = Number(row.chunk_count) || 0;
  const embeddedChunkCount = Number(row.embedded_chunk_count) || 0;
  return {
    id: row.id,
    filename: row.filename,
    scope,
    sessionId: row.session_id,
    characterId: row.character_id,
    byteSize: Number(row.byte_size) || 0,
    pageCount: Number(row.page_count) || 0,
    chunkCount,
    hasFile:
      Boolean(row.storage_bucket && row.storage_path) ||
      row.has_file === true ||
      row.has_file === "t" ||
      row.has_file === 1,
    createdAt: iso(row.created_at) || "",
    status,
    error: status === "failed" ? row.error ?? null : null,
    errorCode: status === "failed" ? row.error_code ?? null : null,
    embeddedChunkCount,
    vectorsPending: status === "ready" && embeddedChunkCount < chunkCount,
    updatedAt: iso(row.updated_at),
  };
}

const LIST_COLUMNS = `${PDF_DOC_COLUMNS},
  EXISTS (
    SELECT 1 FROM pdf_file_parts p
    WHERE p.document_id = pdf_documents.id AND p.user_id = pdf_documents.user_id
  ) AS has_file`;

async function userOwnsChatSession(userId: string, sessionId: string): Promise<boolean> {
  const rows = await queryRows<{ ok: number }>(
    `SELECT 1 AS ok FROM user_entities
     WHERE user_id = $1 AND entity_name = $2 AND entity_id = $3
     LIMIT 1`,
    [userId, CHAT_SESSION, sessionId],
  );
  return rows.length > 0;
}

async function userOwnsCompanion(userId: string, characterId: string): Promise<boolean> {
  const rows = await queryRows<{ ok: number }>(
    `SELECT 1 AS ok FROM user_entities
     WHERE user_id = $1 AND entity_id = $2
       AND entity_name IN ('Character', 'Anima')
     LIMIT 1`,
    [userId, characterId],
  );
  return rows.length > 0;
}

// ── Pipeline wiring ───────────────────────────────────────────────────────

/** Companions that should remember a shared PDF: lore owner, or the chat's cast. */
async function documentCharacters(doc: PdfPipelineDoc): Promise<string[]> {
  if (doc.scope === "lore") return doc.characterId ? [doc.characterId] : [];
  if (!doc.sessionId) return [];
  const rows = await queryRows<{ data: Record<string, unknown> | null }>(
    `SELECT data FROM user_entities
     WHERE user_id = $1 AND entity_name = $2 AND entity_id = $3 LIMIT 1`,
    [doc.userId, CHAT_SESSION, doc.sessionId],
  );
  const data = rows[0]?.data || {};
  const group = Array.isArray(data.group_character_ids) ? data.group_character_ids : [];
  return safeEntityIds([data.character_id, ...group], 4);
}

/**
 * Memory core link: one `document_shared` event per companion, idempotent on
 * dedupe_key `pdf:<document>:<character>`. The PDF text itself is not copied
 * into memory_events (append-only, and a deleted PDF must stop being recalled).
 */
async function linkDocumentToMemory(doc: PdfPipelineDoc): Promise<void> {
  if (!isMemoryCoreEnabled()) return;
  const characters = await documentCharacters(doc);
  for (const characterId of characters) {
    await appendMemoryEvent(
      {
        userId: doc.userId,
        characterId,
        eventType: "document_shared",
        content: `${doc.scope === "lore" ? "Added a lore PDF" : "Shared a PDF in chat"}: "${doc.filename}" (${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"})`,
        payload: { document_id: doc.id, scope: doc.scope, filename: doc.filename, page_count: doc.pageCount },
        emotionalWeight: 0.35,
        conversationId: doc.sessionId,
        dedupeKey: `pdf:${doc.id}:${characterId}`,
        source: "pdf",
      },
      { embed: false },
    ).catch((err) => {
      if (!isMissingRelation(err)) throw err;
    });
  }
}

/** Retract the `document_shared` events of deleted PDFs (append-only forgetting). */
async function retractDocumentMemories(userId: string, documentIds: string[]): Promise<void> {
  if (!documentIds.length || !isMemoryCoreEnabled()) return;
  try {
    const keys = documentIds.map((id) => `pdf:${id}:%`);
    const rows = await queryRows<{ id: string; character_id: string }>(
      `SELECT id, character_id FROM memory_events
       WHERE user_id = $1 AND event_type = 'document_shared' AND dedupe_key LIKE ANY ($2::text[])`,
      [userId, keys],
    );
    for (const row of rows) {
      await retractMemory(userId, row.character_id, row.id, "PDF deleted").catch(() => {});
    }
  } catch {
    // Memory core not migrated, or offline: nothing was linked.
  }
}

export function pdfPipelineDeps(overrides: Partial<PdfPipelineDeps> = {}): PdfPipelineDeps {
  return {
    repo: sqlPdfPipelineRepo,
    blobs: (ref) => storeFor(ref),
    embed: embedPdfTexts,
    embedderAvailable: () => pdfEmbedderAvailable(),
    onReady: linkDocumentToMemory,
    log: (msg, extra) => console.warn(msg, extra || {}),
    ...overrides,
  };
}

/** Background hook: Worker ctx.waitUntil via scheduleWorkerBackground, or plain Node. */
export type PdfBackground = (promise: Promise<unknown>) => void;
const runDetached: PdfBackground = (promise) => {
  promise.catch((err) => console.warn("pdf background step failed", String(err)));
};

async function loadDocument(userId: string, documentId: string): Promise<PdfDocumentRecord | null> {
  const rows = await queryRows<PdfDocRow>(
    `SELECT ${LIST_COLUMNS} FROM pdf_documents WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [documentId, userId],
  );
  return rows[0] ? mapDocument(rows[0]) : null;
}

async function removeDocumentRows(userId: string, documentId: string): Promise<boolean> {
  await queryRows(`DELETE FROM pdf_file_parts WHERE document_id = $1 AND user_id = $2`, [documentId, userId]);
  // pdf_chunk_embeddings rows cascade from pdf_chunks / pdf_documents.
  await queryRows(`DELETE FROM pdf_chunks WHERE document_id = $1 AND user_id = $2`, [documentId, userId]);
  const removed = await queryRows<{ id: string }>(
    `DELETE FROM pdf_documents WHERE id = $1 AND user_id = $2 RETURNING id`,
    [documentId, userId],
  );
  return removed.length > 0;
}

async function removeStoredObjects(
  userId: string,
  refs: { id: string; storage_bucket: string | null; storage_path: string | null }[],
): Promise<void> {
  await Promise.all(
    refs
      .filter((ref) => ref.storage_bucket && ref.storage_path)
      .map((ref) =>
        storeFor({ bucket: ref.storage_bucket })
          .remove({ userId, documentId: ref.id, bucket: ref.storage_bucket, path: ref.storage_path })
          .catch((err) => console.warn("pdf storage delete failed", String(err))),
      ),
  );
}

async function countScoped(
  userId: string,
  scope: PdfScope,
  ownerId: string,
): Promise<number> {
  const sql =
    scope === "chat"
      ? `SELECT count(*)::int AS n FROM pdf_documents
         WHERE user_id = $1 AND scope = 'chat' AND session_id = $2`
      : `SELECT count(*)::int AS n FROM pdf_documents
         WHERE user_id = $1 AND scope = 'lore' AND character_id = $2`;
  const rows = await queryRows<{ n: number | string }>(sql, [userId, ownerId]);
  return Number(rows[0]?.n) || 0;
}

export type StoredPdfFile = {
  filename: string;
  /** Null when this row was saved before original bytes were kept. */
  bytes: Buffer | null;
};

/** Owner-only. Null when the document is not theirs. */
export async function readPdfFile(
  userId: string,
  documentId: unknown,
): Promise<StoredPdfFile | null> {
  const owner = safeEntityId(userId);
  const id = safeEntityId(documentId);
  if (!owner || !id) return null;
  return withPdfTable(async () => {
    const docs = await queryRows<{ filename: string; storage_bucket: string | null; storage_path: string | null }>(
      `SELECT filename, storage_bucket, storage_path FROM pdf_documents WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, owner],
    );
    const doc = docs[0];
    if (!doc) return null;
    const ref = { bucket: doc.storage_bucket, path: doc.storage_path };
    const bytes = await storeFor(ref).get({ userId: owner, documentId: id, ...ref });
    return { filename: doc.filename, bytes: bytes ? Buffer.from(bytes) : null };
  });
}

export async function createPdfDocument(input: {
  userId: string;
  scope: unknown;
  sessionId?: unknown;
  characterId?: unknown;
  filename?: unknown;
  /** Legacy JSON upload (≤ PDF_MAX_BASE64_BYTES decoded). */
  dataBase64?: unknown;
  /** Raw `application/pdf` body (≤ pdfMaxBytes()). */
  bytes?: Uint8Array;
  contentType?: unknown;
  /** Where to run embedding after the response (Worker waitUntil). */
  background?: PdfBackground;
  /** Test seams. */
  blobStore?: PdfBlobStore;
  deps?: Partial<PdfPipelineDeps>;
}): Promise<PdfDocumentRecord> {
  const userId = safeEntityId(input.userId);
  if (!userId) {
    throw new PdfUploadError("You need to be signed in to upload a PDF.", "pdf_unauthorized", 401);
  }
  const scope = asScope(input.scope);
  if (!scope) {
    throw new PdfUploadError("Choose a chat or a companion lore upload.", "pdf_bad_scope", 400);
  }
  const sessionId = scope === "chat" ? safeEntityId(input.sessionId) : null;
  const characterId = scope === "lore" ? safeEntityId(input.characterId) : null;
  if (scope === "chat" && !sessionId) {
    throw new PdfUploadError(
      "Open the conversation first, then attach the PDF.",
      "pdf_bad_session",
      400,
    );
  }
  if (scope === "lore" && !characterId) {
    throw new PdfUploadError(
      "Save the companion first, then add a lore PDF.",
      "pdf_bad_character",
      400,
    );
  }

  const filename = sanitizePdfFilename(input.filename);
  const deps = pdfPipelineDeps(input.deps);

  return withPdfTable(async () => {
    if (scope === "chat" && sessionId) {
      const owns = await userOwnsChatSession(userId, sessionId);
      if (!owns) {
        throw new PdfUploadError(
          "That conversation wasn't found.",
          "pdf_not_found",
          404,
        );
      }
    }
    if (scope === "lore" && characterId) {
      const owns = await userOwnsCompanion(userId, characterId);
      if (!owns) {
        throw new PdfUploadError(
          "That companion wasn't found.",
          "pdf_not_found",
          404,
        );
      }
    }

    // Validate before anything is stored: MIME, size, %PDF- magic bytes.
    const raw = input.bytes instanceof Uint8Array;
    const bytes = raw ? (input.bytes as Uint8Array) : decodePdfBase64(String(input.dataBase64 || ""));
    validatePdfUpload({
      bytes,
      contentType: input.contentType,
      maxBytes: raw ? pdfMaxBytes() : PDF_MAX_BASE64_BYTES,
    });
    const byteSize = bytes.byteLength;
    const sha = sha256Hex(bytes);
    const ownerId = (scope === "chat" ? sessionId : characterId) as string;

    // Idempotent re-upload: the same bytes into the same chat / companion
    // return the existing document (and re-run it if it had failed).
    const existing = await queryRows<PdfDocRow>(
      `SELECT ${LIST_COLUMNS} FROM pdf_documents
       WHERE user_id = $1 AND content_sha256 = $2 AND scope = $3
         AND (CASE WHEN scope = 'chat' THEN session_id ELSE character_id END) = $4
       ORDER BY created_at DESC LIMIT 1`,
      [userId, sha, scope, ownerId],
    );
    if (existing[0]) {
      const record = mapDocument(existing[0]);
      if (record.status !== "failed") return record;
      return (await retryPdfDocument({ userId, documentId: record.id, background: input.background, deps: input.deps })) ?? record;
    }

    const count = await countScoped(userId, scope, ownerId);
    const cap = scope === "chat" ? PDF_MAX_FILES_PER_CHAT : PDF_MAX_FILES_PER_LORE;
    if (count >= cap) {
      throw new PdfUploadError(
        scope === "chat"
          ? `This chat already has ${PDF_MAX_FILES_PER_CHAT} PDFs. Remove one before adding another.`
          : `This companion already has ${PDF_MAX_FILES_PER_LORE} lore PDFs. Remove one before adding another.`,
        "pdf_too_many_files",
        409,
      );
    }

    // 1. uploaded: row first (pdf_file_parts references it), then the original.
    const id = randomUUID();
    await queryRows(
      `INSERT INTO pdf_documents (
         id, user_id, scope, session_id, character_id, filename, byte_size,
         status, content_sha256
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded', $8)`,
      [id, userId, scope, sessionId, characterId, filename, byteSize, sha],
    );
    const blobs = input.blobStore ?? defaultPdfBlobStore();
    try {
      const ref = await blobs.put({ userId, documentId: id, bytes });
      await queryRows(
        `UPDATE pdf_documents SET storage_bucket = $3, storage_path = $4, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [id, userId, ref.bucket, ref.path],
      );
    } catch (error) {
      await removeDocumentRows(userId, id).catch(() => {});
      throw error;
    }

    // 2–4. extract → chunk inline (fast, and a bad file is reported right
    // away); embedding continues after the response.
    const pipelineDeps: PdfPipelineDeps = input.blobStore ? { ...deps, blobs: () => input.blobStore! } : deps;
    const result = await runPdfPipeline(pipelineDeps, {
      documentId: id,
      userId,
      bytes,
      embed: "defer",
    });
    if (result.error && result.permanent) {
      // The file itself is unusable: keep nothing, tell the user why.
      const ref = await queryRows<{ id: string; storage_bucket: string | null; storage_path: string | null }>(
        `SELECT id, storage_bucket, storage_path FROM pdf_documents WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      await removeDocumentRows(userId, id).catch(() => {});
      await removeStoredObjects(userId, ref);
      throw result.error;
    }
    scheduleEmbedding(pipelineDeps, result, input.background);
    const record = await loadDocument(userId, id);
    if (!record) throw new PdfUploadError("That file wasn't found.", "pdf_not_found", 404);
    return record;
  });
}

function scheduleEmbedding(deps: PdfPipelineDeps, result: PipelineResult, background?: PdfBackground) {
  if (result.doc?.status !== "embedding") return;
  const doc = result.doc;
  (background ?? runDetached)(embedPendingChunks(deps, { documentId: doc.id, userId: doc.userId }));
}

/** One document with its pipeline status (owner only). */
export async function getPdfDocument(input: {
  userId: string;
  documentId: unknown;
}): Promise<PdfDocumentRecord | null> {
  const userId = safeEntityId(input.userId);
  const documentId = safeEntityId(input.documentId);
  if (!userId || !documentId) return null;
  return withPdfTable(() => loadDocument(userId, documentId));
}

/**
 * Nudge a document forward without blocking the caller: resume embedding, or
 * reclaim a processing run whose isolate died. Called from the status route
 * so a client poll keeps the pipeline moving between cron ticks.
 */
export function advancePdfDocument(
  doc: PdfDocumentRecord,
  userId: string,
  background?: PdfBackground,
  overrides?: Partial<PdfPipelineDeps>,
): void {
  const deps = pdfPipelineDeps(overrides);
  const updatedAt = doc.updatedAt ? Date.parse(doc.updatedAt) : 0;
  const stale = !updatedAt || Date.now() - updatedAt > PDF_STALE_PROCESSING_MS;
  const run = background ?? runDetached;
  if (doc.status === "embedding" && stale) {
    run(embedPendingChunks(deps, { documentId: doc.id, userId }));
  } else if (doc.vectorsPending && deps.embedderAvailable() && stale) {
    run(embedPendingChunks(deps, { documentId: doc.id, userId, maxBatches: 2 }));
  } else if ((doc.status === "uploaded" || doc.status === "extracting" || doc.status === "chunking") && stale) {
    run(runPdfPipeline(deps, { documentId: doc.id, userId, embed: "inline" }));
  }
}

/** Re-run a failed (or abandoned) document from its stored original. */
export async function retryPdfDocument(input: {
  userId: string;
  documentId: unknown;
  background?: PdfBackground;
  deps?: Partial<PdfPipelineDeps>;
}): Promise<PdfDocumentRecord | null> {
  const userId = safeEntityId(input.userId);
  const documentId = safeEntityId(input.documentId);
  if (!userId || !documentId) return null;
  return withPdfTable(async () => {
    const current = await loadDocument(userId, documentId);
    if (!current) return null;
    const deps = pdfPipelineDeps(input.deps);
    if (current.status === "ready" || current.status === "embedding") {
      if (current.status === "embedding" || current.vectorsPending) {
        (input.background ?? runDetached)(embedPendingChunks(deps, { documentId, userId }));
      }
      return current;
    }
    const result = await runPdfPipeline(deps, { documentId, userId, embed: "defer" });
    scheduleEmbedding(deps, result, input.background);
    return loadDocument(userId, documentId);
  });
}

export async function listPdfDocuments(input: {
  userId: string;
  scope: unknown;
  sessionId?: unknown;
  characterId?: unknown;
}): Promise<PdfDocumentRecord[]> {
  const userId = safeEntityId(input.userId);
  const scope = asScope(input.scope);
  if (!userId || !scope) return [];
  const ownerId =
    scope === "chat" ? safeEntityId(input.sessionId) : safeEntityId(input.characterId);
  if (!ownerId) return [];
  const sql =
    scope === "chat"
      ? `SELECT ${LIST_COLUMNS}
         FROM pdf_documents
         WHERE user_id = $1 AND scope = 'chat' AND session_id = $2
         ORDER BY created_at ASC`
      : `SELECT ${LIST_COLUMNS}
         FROM pdf_documents
         WHERE user_id = $1 AND scope = 'lore' AND character_id = $2
         ORDER BY created_at ASC`;
  const rows = await withPdfTable(() => queryRows<PdfDocRow>(sql, [userId, ownerId]));
  return rows.map(mapDocument);
}

export async function renamePdfDocument(input: {
  userId: string;
  documentId: unknown;
  filename: unknown;
}): Promise<PdfDocumentRecord | null> {
  const userId = safeEntityId(input.userId);
  const documentId = safeEntityId(input.documentId);
  if (!userId || !documentId) return null;
  const filename = sanitizePdfFilename(input.filename);
  return withPdfTable(async () => {
    const updated = await queryRows<PdfDocRow>(
      `UPDATE pdf_documents
       SET filename = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${LIST_COLUMNS}`,
      [documentId, userId, filename],
    );
    if (!updated[0]) return null;
    await queryRows(
      `UPDATE pdf_chunks
       SET search_vector = to_tsvector('english', $3::text || ' ' || content)
       WHERE document_id = $1 AND user_id = $2`,
      [documentId, userId, filename],
    );
    return mapDocument(updated[0]);
  });
}

export async function deletePdfDocument(input: {
  userId: string;
  documentId: unknown;
}): Promise<boolean> {
  const userId = safeEntityId(input.userId);
  const documentId = safeEntityId(input.documentId);
  if (!userId || !documentId) return false;
  return withPdfTable(async () => {
    const refs = await queryRows<{ id: string; storage_bucket: string | null; storage_path: string | null }>(
      `SELECT id, storage_bucket, storage_path FROM pdf_documents WHERE id = $1 AND user_id = $2`,
      [documentId, userId],
    );
    const removed = await removeDocumentRows(userId, documentId);
    if (removed) {
      await removeStoredObjects(userId, refs);
      await retractDocumentMemories(userId, [documentId]);
    }
    return removed;
  });
}

type StoredRef = { id: string; storage_bucket: string | null; storage_path: string | null };

/** Delete every document matching `where` ($1 = user), plus objects and memory links. */
async function deleteDocumentsWhere(owner: string, where: string, values: unknown[]): Promise<void> {
  await withPdfTable(async () => {
    const refs = await queryRows<StoredRef>(
      `SELECT id, storage_bucket, storage_path FROM pdf_documents WHERE user_id = $1 AND ${where}`,
      [owner, ...values],
    );
    await queryRows(
      `DELETE FROM pdf_file_parts
       WHERE user_id = $1 AND document_id IN (
         SELECT id FROM pdf_documents WHERE user_id = $1 AND ${where}
       )`,
      [owner, ...values],
    );
    await queryRows(
      `DELETE FROM pdf_chunks
       WHERE user_id = $1 AND document_id IN (
         SELECT id FROM pdf_documents WHERE user_id = $1 AND ${where}
       )`,
      [owner, ...values],
    );
    await queryRows(`DELETE FROM pdf_documents WHERE user_id = $1 AND ${where}`, [owner, ...values]);
    await removeStoredObjects(owner, refs);
    await retractDocumentMemories(
      owner,
      refs.map((ref) => ref.id),
    );
  });
}

export async function deleteLorePdfsForCharacter(
  userId: string,
  characterId: string,
): Promise<void> {
  const owner = safeEntityId(userId);
  const character = safeEntityId(characterId);
  if (!owner || !character) return;
  await deleteDocumentsWhere(owner, `scope = 'lore' AND character_id = $2`, [character]);
}

export async function deleteChatPdfsForSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  const owner = safeEntityId(userId);
  const session = safeEntityId(sessionId);
  if (!owner || !session) return;
  await deleteDocumentsWhere(owner, `scope = 'chat' AND session_id = $2`, [session]);
}

export async function deleteAllPdfDocumentsForUser(userId: string): Promise<void> {
  const owner = safeEntityId(userId);
  if (!owner) return;
  await withPdfTable(async () => {
    const refs = await queryRows<StoredRef>(
      `SELECT id, storage_bucket, storage_path FROM pdf_documents WHERE user_id = $1`,
      [owner],
    );
    await queryRows(`DELETE FROM pdf_file_parts WHERE user_id = $1`, [owner]);
    await queryRows(`DELETE FROM pdf_chunks WHERE user_id = $1`, [owner]);
    await queryRows(`DELETE FROM pdf_documents WHERE user_id = $1`, [owner]);
    await removeStoredObjects(owner, refs);
  });
}

type HitRow = {
  chunk_id?: string | null;
  content: string;
  page_start: number | string;
  page_end: number | string;
  filename: string;
  scope: string;
  rank: number | string | null;
};

function mapHit(row: HitRow): PdfHit {
  const scope = row.scope === "lore" ? "lore" : "chat";
  return {
    filename: row.filename,
    scope,
    pageStart: Number(row.page_start) || 1,
    pageEnd: Number(row.page_end) || 1,
    content: String(row.content || ""),
    rank: Number(row.rank) || 0,
    ...(row.chunk_id ? { chunkId: String(row.chunk_id) } : {}),
  };
}

/** Reciprocal-rank fusion constant (Cormack et al.); 60 is the usual default. */
const RRF_K = 60;

/**
 * Merge keyword and vector hit lists. Each list contributes 1 / (k + rank);
 * a chunk found by both rises to the top. Ties keep keyword order.
 */
export function fusePdfHits(keyword: PdfHit[], vector: PdfHit[], max = PDF_CONTEXT_MAX_HITS): PdfHit[] {
  const scored = new Map<string, { hit: PdfHit; score: number; order: number }>();
  let order = 0;
  const add = (list: PdfHit[]) => {
    list.forEach((hit, index) => {
      const key = hit.chunkId || `${hit.filename}|${hit.pageStart}|${hit.content.slice(0, 64)}`;
      const entry = scored.get(key);
      const gain = 1 / (RRF_K + index + 1);
      if (entry) entry.score += gain;
      else scored.set(key, { hit, score: gain, order: order++ });
    });
  };
  add(keyword);
  add(vector);
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .map((entry) => ({ ...entry.hit, rank: Number(entry.score.toFixed(6)) }));
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/**
 * pgvector recall through match_pdf_chunks (20261022210000_pdf_pipeline.sql).
 * The query embedding is shared with memory-core recall for the same message
 * (embedQueryCached). Any failure — no embedder, no vector table, slow host —
 * returns [] and the turn falls back to full-text hits.
 */
async function vectorPdfHits(input: {
  userId: string;
  sessionId: string | null;
  characterIds: string[];
  query: string;
}): Promise<PdfHit[]> {
  if (!pdfEmbedderAvailable() || !String(input.query || "").trim()) return [];
  const emb = await withTimeout(
    embedQueryCached(input.query, { provider: pdfEmbedProvider(), timeoutMs: PDF_QUERY_EMBED_TIMEOUT_MS }),
    PDF_QUERY_EMBED_TIMEOUT_MS,
    null,
  );
  if (!emb) return [];
  try {
    const rows = await queryRows<HitRow>(
      `SELECT chunk_id, content, page_start, page_end, filename, scope, similarity AS rank
       FROM match_pdf_chunks($1, $2::vector, $3, $4::text[], $5, $6, $7)`,
      [
        input.userId,
        toVectorLiteral(emb.vector),
        input.sessionId,
        input.characterIds,
        PDF_CONTEXT_MAX_HITS,
        PDF_VECTOR_MIN_SIMILARITY,
        emb.model,
      ],
    );
    return rows.map(mapHit);
  } catch {
    return [];
  }
}

/**
 * Hybrid lookup for this turn: Postgres full-text + pgvector similarity,
 * fused by reciprocal rank, then packed into PDF_CONTEXT_WORD_BUDGET.
 * Chat attachments and lore share that budget. Only documents that reached
 * `embedding` or `ready` (i.e. have chunks) are visible. The caller only runs
 * this when the turn stays on the self-hosted model (routes/chat.ts).
 */
export async function retrievePdfContext(input: {
  userId: string;
  sessionId: string;
  characterIds: string[];
  query: string;
}): Promise<string> {
  const userId = safeEntityId(input.userId);
  const sessionId = safeEntityId(input.sessionId);
  const characterIds = safeEntityIds(input.characterIds);
  if (!userId || (!sessionId && characterIds.length === 0)) return "";

  return withPdfTable(async () => {
    const terms = pdfSearchTerms(input.query);
    const tsQuery = terms.length ? pdfTsQuery(terms) : null;
    const filesSql = buildPdfRetrievalSql({
      userId,
      sessionId,
      characterIds,
      tsQuery: null,
      mode: "files",
    });
    const searchSql =
      tsQuery &&
      buildPdfRetrievalSql({
        userId,
        sessionId,
        characterIds,
        tsQuery,
        mode: "search",
      });
    const [fileRows, hitRows, vectorHits] = await Promise.all([
      filesSql
        ? queryRows<{ filename: string; scope: string; page_count: number | string }>(
            filesSql.text,
            filesSql.values,
          )
        : Promise.resolve([]),
      searchSql
        ? queryRows<HitRow>(searchSql.text, searchSql.values).catch(() => [] as HitRow[])
        : Promise.resolve([] as HitRow[]),
      vectorPdfHits({ userId, sessionId, characterIds, query: input.query }),
    ]);
    const files: PdfFileSummary[] = fileRows.map((row) => ({
      filename: row.filename,
      scope: row.scope === "lore" ? "lore" : "chat",
      pageCount: Number(row.page_count) || 0,
    }));
    if (!files.length) return "";

    const hits = fusePdfHits(hitRows.map(mapHit), vectorHits);
    let fallback: PdfHit | null = null;
    if (!hits.length && sessionId) {
      const fallbackSql = buildPdfRetrievalSql({
        userId,
        sessionId,
        characterIds: [],
        tsQuery: null,
        mode: "fallback",
      });
      if (fallbackSql) {
        const rows = await queryRows<HitRow>(fallbackSql.text, fallbackSql.values);
        fallback = rows[0] ? mapHit(rows[0]) : null;
      }
    }
    return packPdfContext({
      files,
      hits,
      fallback,
    });
  });
}

// ── Cron ──────────────────────────────────────────────────────────────────

/**
 * Hourly (worker.ts → scheduled): reclaim abandoned uploads and fill vectors
 * that were deferred because the embedder was down. Bounded per tick.
 */
export async function backfillPdfPipelines(
  options: { maxDocuments?: number; overrides?: Partial<PdfPipelineDeps> } = {},
): Promise<{ resumed: number; embedded: number }> {
  const deps = pdfPipelineDeps(options.overrides);
  const limit = Math.min(Math.max(options.maxDocuments ?? 8, 1), 32);
  let resumed = 0;
  let embedded = 0;
  const stale = await queryRows<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM pdf_documents
     WHERE status IN ('uploaded', 'extracting', 'chunking')
       AND COALESCE(processing_started_at, updated_at) < now() - ($1::int * interval '1 millisecond')
     ORDER BY updated_at ASC LIMIT $2`,
    [PDF_STALE_PROCESSING_MS, limit],
  );
  for (const row of stale) {
    await runPdfPipeline(deps, { documentId: row.id, userId: row.user_id, embed: "inline" }).catch(() => null);
    resumed += 1;
  }
  if (!deps.embedderAvailable()) return { resumed, embedded };
  const pending = await queryRows<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM pdf_documents
     WHERE status IN ('embedding', 'ready') AND embedded_chunk_count < chunk_count
     ORDER BY updated_at ASC LIMIT $1`,
    [limit],
  );
  for (const row of pending) {
    const result = await embedPendingChunks(deps, { documentId: row.id, userId: row.user_id }).catch(() => null);
    if (result?.doc) embedded += 1;
  }
  return { resumed, embedded };
}
