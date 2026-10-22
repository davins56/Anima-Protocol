/**
 * Uploaded PDFs → persistent memory (supabase/migrations/20261022260000_document_memory.sql).
 *
 * After a PDF is extracted and chunked (lib/pdf/store.ts), each chunk is
 * appended to memory_events as a `document_chunk` event with a 768-d
 * embedding, so recall_memories can surface it next to conversation memories
 * (relevance + recency blend). Writes are idempotent (dedupe key per
 * document/chunk) and append-only: removing a PDF appends `retraction` events
 * for its chunks; no memory row is ever updated or deleted.
 *
 * Everything here is best-effort: a failure never fails the upload, the PDF
 * stays usable through the existing pdf_chunks full-text path.
 */
import { getPool } from "@workspace/db";
import { embedMemoryTexts, toVectorLiteral } from "../memoryCore/embedder";

// Same switch as memoryCore/sessionContext.isMemoryCoreEnabled (kept local to avoid an import cycle).
function isMemoryCoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.ANIMA_MEMORY_CORE || "on").trim().toLowerCase();
  return !(raw === "0" || raw === "off" || raw === "false" || raw === "no");
}

export const DOCUMENT_CHUNK_EVENT = "document_chunk";
/** Cap per document so one huge PDF can't flood recall. */
export const DOCUMENT_MEMORY_MAX_CHUNKS = 64;
const EMBED_BATCH = 16;

export type DocumentChunkInput = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
};

export type DocumentMemoryEvent = {
  userId: string;
  characterId: string;
  eventType: typeof DOCUMENT_CHUNK_EVENT;
  content: string;
  payload: {
    document_id: string;
    chunk_index: number;
    page_start: number;
    page_end: number;
    filename: string;
    scope: "chat" | "lore";
    session_id: string | null;
  };
  conversationId: string | null;
  dedupeKey: string;
  emotionalWeight: number;
  source: "pdf_upload";
};

export function documentMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isMemoryCoreEnabled(env)) return false;
  const raw = (env.ANIMA_DOCUMENT_MEMORY || "on").trim().toLowerCase();
  return !(raw === "0" || raw === "off" || raw === "false" || raw === "no");
}

/** Pure: the memory events one uploaded document becomes. */
export function buildDocumentChunkEvents(args: {
  userId: string;
  characterId: string;
  documentId: string;
  filename: string;
  scope: "chat" | "lore";
  sessionId: string | null;
  chunks: DocumentChunkInput[];
  maxChunks?: number;
}): DocumentMemoryEvent[] {
  const max = Math.max(1, args.maxChunks ?? DOCUMENT_MEMORY_MAX_CHUNKS);
  return args.chunks
    .filter((c) => String(c.content || "").trim())
    .slice(0, max)
    .map((c) => ({
      userId: args.userId,
      characterId: args.characterId,
      eventType: DOCUMENT_CHUNK_EVENT,
      content: String(c.content).replace(/\s+/g, " ").trim().slice(0, 4000),
      payload: {
        document_id: args.documentId,
        chunk_index: c.chunkIndex,
        page_start: c.pageStart,
        page_end: c.pageEnd,
        filename: args.filename,
        scope: args.scope,
        session_id: args.sessionId,
      },
      conversationId: args.scope === "chat" ? args.sessionId : null,
      dedupeKey: `doc:${args.documentId}:${c.chunkIndex}`,
      // Lore the user chose to give her matters a bit more than a chat handout.
      emotionalWeight: args.scope === "lore" ? 0.45 : 0.35,
      source: "pdf_upload",
    }));
}

/** Pure: how a recalled document chunk reads in the prompt. */
export function documentRecallLabel(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload || typeof payload.document_id !== "string") return null;
  const name = String(payload.filename || "a PDF").slice(0, 80);
  const a = Number(payload.page_start);
  const b = Number(payload.page_end);
  const pages = Number.isFinite(a) && a > 0 ? (Number.isFinite(b) && b > a ? ` pp. ${a}–${b}` : ` p. ${a}`) : "";
  return `from "${name}"${pages}`;
}

/** Character a chat-scoped PDF belongs to (solo chats only; group chats skip memory). */
export async function characterForChatSession(userId: string, sessionId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ character_id: string | null; character_ids: unknown }>(
    `SELECT character_id, character_ids FROM chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [sessionId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.character_id) return String(row.character_id);
  const ids = Array.isArray(row.character_ids) ? row.character_ids : [];
  return ids.length === 1 ? String(ids[0]) : null;
}

/** Append the document's chunks as embedded memory events. Returns rows written. */
export async function ingestDocumentIntoMemory(args: {
  userId: string;
  documentId: string;
  filename: string;
  scope: "chat" | "lore";
  sessionId: string | null;
  characterId: string | null;
  chunks: DocumentChunkInput[];
}): Promise<number> {
  if (!documentMemoryEnabled()) return 0;
  const characterId =
    args.characterId || (args.scope === "chat" && args.sessionId ? await characterForChatSession(args.userId, args.sessionId) : null);
  if (!characterId) return 0;
  const events = buildDocumentChunkEvents({ ...args, characterId });
  let written = 0;
  for (let i = 0; i < events.length; i += EMBED_BATCH) {
    const batch = events.slice(i, i + EMBED_BATCH);
    // Embedding is optional: rows without one are picked up by backfillMemoryEmbeddings.
    const embs = (await embedMemoryTexts(batch.map((e) => e.content)).catch(() => null)) || [];
    for (let j = 0; j < batch.length; j++) {
      const e = batch[j];
      const emb = embs[j] || null;
      const { rows } = await getPool().query(
        `INSERT INTO memory_events
           (user_id, character_id, conversation_id, event_type, content, payload,
            emotional_weight, embedding, embedding_model, dedupe_key, source)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::vector,$9,$10,$11)
         ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          e.userId,
          e.characterId,
          e.conversationId,
          e.eventType,
          e.content,
          JSON.stringify(e.payload),
          e.emotionalWeight,
          emb ? toVectorLiteral(emb.vector) : null,
          emb?.model ?? null,
          e.dedupeKey,
          e.source,
        ],
      );
      written += rows.length;
    }
  }
  return written;
}

/**
 * The user removed a PDF: append a retraction for each of its chunk events so
 * recall stops surfacing them. Append-only; memory_events rows are untouched.
 */
export async function retractDocumentFromMemory(userId: string, documentId: string): Promise<number> {
  if (!isMemoryCoreEnabled()) return 0;
  const { rows } = await getPool().query(
    `INSERT INTO memory_events (user_id, character_id, event_type, content, payload, dedupe_key, source)
     SELECT e.user_id, e.character_id, 'retraction', 'PDF removed by the user',
            jsonb_build_object('target_event_id', e.id::text, 'reason', 'document_removed', 'document_id', $2::text),
            'retract:' || e.id::text, 'pdf_upload'
     FROM memory_events e
     WHERE e.user_id = $1 AND e.event_type = 'document_chunk' AND e.payload ->> 'document_id' = $2
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [userId, documentId],
  );
  return rows.length;
}

/** Fire-and-forget wrapper used by the upload path. */
export function queueDocumentMemory(args: Parameters<typeof ingestDocumentIntoMemory>[0]): void {
  void ingestDocumentIntoMemory(args).catch((err) => {
    console.warn("[pdf] document memory ingest skipped:", (err as Error)?.message || err);
  });
}
