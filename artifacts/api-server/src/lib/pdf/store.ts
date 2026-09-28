import { randomUUID } from "crypto";
import {
  CHAT_SESSION,
  ensureSchemaOnce,
  getPool,
  withTransientDbRetry,
} from "@workspace/db";
import { chunkPdfPages } from "./chunk";
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
import { decodePdfBase64, extractPdfPages } from "./extract";
import {
  PDF_MAX_FILES_PER_CHAT,
  PDF_MAX_FILES_PER_LORE,
} from "./limits";

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
  createdAt: string;
};

type DocumentRow = {
  id: string;
  filename: string;
  scope: string;
  session_id: string | null;
  character_id: string | null;
  byte_size: number | string;
  page_count: number | string;
  chunk_count: number | string;
  created_at: Date | string;
};

function isMissingPdfTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  return (
    code === "42P01" ||
    /relation ["']?(pdf_documents|pdf_chunks)["']? does not exist/i.test(message)
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

function mapDocument(row: DocumentRow): PdfDocumentRecord {
  const scope = asScope(row.scope) ?? "chat";
  return {
    id: row.id,
    filename: row.filename,
    scope,
    sessionId: row.session_id,
    characterId: row.character_id,
    byteSize: Number(row.byte_size) || 0,
    pageCount: Number(row.page_count) || 0,
    chunkCount: Number(row.chunk_count) || 0,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at || ""),
  };
}

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

export async function createPdfDocument(input: {
  userId: string;
  scope: unknown;
  sessionId?: unknown;
  characterId?: unknown;
  filename?: unknown;
  dataBase64?: unknown;
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
  const id = randomUUID();

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
      const count = await countScoped(userId, "chat", sessionId);
      if (count >= PDF_MAX_FILES_PER_CHAT) {
        throw new PdfUploadError(
          `This chat already has ${PDF_MAX_FILES_PER_CHAT} PDFs. Remove one before adding another.`,
          "pdf_too_many_files",
          409,
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
      const count = await countScoped(userId, "lore", characterId);
      if (count >= PDF_MAX_FILES_PER_LORE) {
        throw new PdfUploadError(
          `This companion already has ${PDF_MAX_FILES_PER_LORE} lore PDFs. Remove one before adding another.`,
          "pdf_too_many_files",
          409,
        );
      }
    }

    const bytes = decodePdfBase64(String(input.dataBase64 || ""));
    const byteSize = bytes.byteLength;
    const extracted = await extractPdfPages(bytes);
    const chunks = chunkPdfPages(extracted.pages);
    if (!chunks.length) {
      throw new PdfUploadError(
        "This PDF has no extractable text. It looks like a scan or pictures only, so I can't read it. Export a text-based PDF and try again.",
        "pdf_no_text",
        422,
      );
    }

    await queryRows(
      `INSERT INTO pdf_documents (
         id, user_id, scope, session_id, character_id, filename,
         byte_size, page_count, chunk_count
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        userId,
        scope,
        sessionId,
        characterId,
        filename,
        byteSize,
        extracted.pageCount,
        chunks.length,
      ],
    );

    const values: unknown[] = [filename, userId, id];
    const rows: string[] = [];
    for (const chunk of chunks) {
      const base = values.length;
      values.push(
        randomUUID(),
        chunk.chunkIndex,
        chunk.pageStart,
        chunk.pageEnd,
        chunk.content,
      );
      rows.push(
        `($${base + 1}::text, $3::text, $2::text, $${base + 2}::int, $${base + 3}::int, $${base + 4}::int, $${base + 5}::text, to_tsvector('english', $1::text || ' ' || $${base + 5}::text))`,
      );
    }
    try {
      await queryRows(
        `INSERT INTO pdf_chunks (
           id, document_id, user_id, chunk_index, page_start, page_end, content, search_vector
         ) VALUES ${rows.join(", ")}`,
        values,
      );
    } catch (error) {
      await queryRows(
        `DELETE FROM pdf_documents WHERE id = $1 AND user_id = $2`,
        [id, userId],
      ).catch(() => {});
      throw error;
    }

    return {
      id,
      filename,
      scope,
      sessionId,
      characterId,
      byteSize,
      pageCount: extracted.pageCount,
      chunkCount: chunks.length,
      createdAt: new Date().toISOString(),
    };
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
      ? `SELECT id, filename, scope, session_id, character_id, byte_size, page_count, chunk_count, created_at
         FROM pdf_documents
         WHERE user_id = $1 AND scope = 'chat' AND session_id = $2
         ORDER BY created_at ASC`
      : `SELECT id, filename, scope, session_id, character_id, byte_size, page_count, chunk_count, created_at
         FROM pdf_documents
         WHERE user_id = $1 AND scope = 'lore' AND character_id = $2
         ORDER BY created_at ASC`;
  const rows = await withPdfTable(() => queryRows<DocumentRow>(sql, [userId, ownerId]));
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
    const updated = await queryRows<DocumentRow>(
      `UPDATE pdf_documents
       SET filename = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, filename, scope, session_id, character_id, byte_size, page_count, chunk_count, created_at`,
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
    await queryRows(
      `DELETE FROM pdf_chunks WHERE document_id = $1 AND user_id = $2`,
      [documentId, userId],
    );
    const removed = await queryRows<{ id: string }>(
      `DELETE FROM pdf_documents WHERE id = $1 AND user_id = $2 RETURNING id`,
      [documentId, userId],
    );
    return removed.length > 0;
  });
}

export async function deleteLorePdfsForCharacter(
  userId: string,
  characterId: string,
): Promise<void> {
  const owner = safeEntityId(userId);
  const character = safeEntityId(characterId);
  if (!owner || !character) return;
  await withPdfTable(async () => {
    await queryRows(
      `DELETE FROM pdf_chunks
       WHERE user_id = $1 AND document_id IN (
         SELECT id FROM pdf_documents
         WHERE user_id = $1 AND scope = 'lore' AND character_id = $2
       )`,
      [owner, character],
    );
    await queryRows(
      `DELETE FROM pdf_documents
       WHERE user_id = $1 AND scope = 'lore' AND character_id = $2`,
      [owner, character],
    );
  });
}

export async function deleteChatPdfsForSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  const owner = safeEntityId(userId);
  const session = safeEntityId(sessionId);
  if (!owner || !session) return;
  await withPdfTable(async () => {
    await queryRows(
      `DELETE FROM pdf_chunks
       WHERE user_id = $1 AND document_id IN (
         SELECT id FROM pdf_documents
         WHERE user_id = $1 AND scope = 'chat' AND session_id = $2
       )`,
      [owner, session],
    );
    await queryRows(
      `DELETE FROM pdf_documents
       WHERE user_id = $1 AND scope = 'chat' AND session_id = $2`,
      [owner, session],
    );
  });
}

export async function deleteAllPdfDocumentsForUser(userId: string): Promise<void> {
  const owner = safeEntityId(userId);
  if (!owner) return;
  await withPdfTable(async () => {
    await queryRows(`DELETE FROM pdf_chunks WHERE user_id = $1`, [owner]);
    await queryRows(`DELETE FROM pdf_documents WHERE user_id = $1`, [owner]);
  });
}

type HitRow = {
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
  };
}

/**
 * One Postgres full-text lookup (plus a file list) for this turn.
 * Chat attachments and lore share PDF_CONTEXT_WORD_BUDGET.
 * Never calls a model, embeddings, Workers AI, or Vectorize.
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
    const [fileRows, hitRows] = await Promise.all([
      filesSql
        ? queryRows<{ filename: string; scope: string; page_count: number | string }>(
            filesSql.text,
            filesSql.values,
          )
        : Promise.resolve([]),
      searchSql
        ? queryRows<HitRow>(searchSql.text, searchSql.values).catch(() => [] as HitRow[])
        : Promise.resolve([] as HitRow[]),
    ]);
    const files: PdfFileSummary[] = fileRows.map((row) => ({
      filename: row.filename,
      scope: row.scope === "lore" ? "lore" : "chat",
      pageCount: Number(row.page_count) || 0,
    }));
    if (!files.length) return "";

    let fallback: PdfHit | null = null;
    if (!hitRows.length && sessionId) {
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
      hits: hitRows.map(mapHit),
      fallback,
    });
  });
}
