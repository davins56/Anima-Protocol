/**
 * Persistent memory core: identity versions, append-only events, recall.
 * SQL: supabase/migrations/20261022160000..160200_memory_*.sql
 */
import { getPool } from "@workspace/db";
import { embedMemoryTexts, embedQueryCached, toVectorLiteral } from "./embedder";

export const MEMORY_EVENT_TYPES = [
  "turn",
  "emotional_beat",
  "decision",
  "image_generated",
  "recall",
  "identity_changed",
  "milestone",
  "note",
  "retraction",
  "document_shared",
] as const;
export type MemoryEventType = (typeof MEMORY_EVENT_TYPES)[number] | (string & {});

export type MemoryEventInput = {
  userId: string;
  characterId: string;
  eventType: MemoryEventType;
  content: string;
  payload?: Record<string, unknown>;
  emotionalWeight?: number;
  conversationId?: string | null;
  messageId?: string | null;
  identityVersion?: number | null;
  dedupeKey?: string | null;
  source?: string;
  occurredAt?: string;
};

export type RecalledMemory = {
  id: string;
  event_type: string;
  content: string;
  payload: Record<string, unknown>;
  conversation_id: string | null;
  occurred_at: string;
  emotional_weight: number;
  similarity: number | null;
  recency: number;
  score: number;
};

export type IdentityCore = {
  id: string;
  character_id: string;
  version: number;
  name: string;
  personality_matrix: Record<string, unknown>;
  voice: Record<string, unknown>;
  core_traits: unknown[];
  relationships: Record<string, unknown>;
  backstory: string;
  created_at: string;
};

export type MemoryHealth = {
  memory_count: number;
  first_memory_at: string | null;
  last_memory_at: string | null;
  identity_version: number | null;
  last_recall_at: string | null;
  oldest_recent_recall: { event_id: string; age_s: number; recalled_at: string; content: string } | null;
};

export function isMissingMemorySchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return (
    e?.code === "42P01" ||
    e?.code === "42883" ||
    /(memory_events|character_identity_core|recall_memories|memory_health).* does not exist/i.test(String(e?.message || ""))
  );
}

function clamp01(n: unknown, d = 0.5): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;
}

/** Append one event (idempotent on dedupeKey). Embeds inline when cheap. */
export async function appendMemoryEvent(e: MemoryEventInput, opts: { embed?: boolean } = {}): Promise<string | null> {
  const content = String(e.content || "").trim().slice(0, 4000);
  if (!content) return null;
  const emb = opts.embed === false ? null : (await embedMemoryTexts([content]))?.[0] || null;
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO memory_events
       (user_id, character_id, conversation_id, message_id, event_type, content, payload,
        emotional_weight, identity_version, embedding, embedding_model, dedupe_key, source, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::vector,$11,$12,$13,COALESCE($14::timestamptz, now()))
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      e.userId,
      e.characterId,
      e.conversationId ?? null,
      e.messageId ?? null,
      e.eventType,
      content,
      JSON.stringify(e.payload || {}),
      clamp01(e.emotionalWeight),
      e.identityVersion ?? null,
      emb ? toVectorLiteral(emb.vector) : null,
      emb?.model ?? null,
      e.dedupeKey ?? null,
      e.source || "api",
      e.occurredAt ?? null,
    ],
  );
  return rows[0]?.id || null;
}

/** Backfill embeddings for events written without one (trigger-logged, offline embedder). */
export async function backfillMemoryEmbeddings(limit = 32): Promise<number> {
  const { rows } = await getPool().query<{ id: string; content: string }>(
    `SELECT id, content FROM memory_events WHERE embedding IS NULL ORDER BY inserted_at ASC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 128)],
  );
  if (!rows.length) return 0;
  const embs = await embedMemoryTexts(rows.map((r) => r.content));
  if (!embs) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const emb = embs[i];
    if (!emb) continue;
    await getPool().query(
      `UPDATE memory_events SET embedding = $2::vector, embedding_model = $3 WHERE id = $1 AND embedding IS NULL`,
      [rows[i].id, toVectorLiteral(emb.vector), emb.model],
    );
    n++;
  }
  return n;
}

export async function recallMemories(args: {
  userId: string;
  characterId: string;
  query?: string;
  limit?: number;
  sessionId?: string | null;
  log?: boolean;
}): Promise<RecalledMemory[]> {
  // Shared with PDF chunk recall for the same turn (one embed call per message).
  const emb = args.query ? await embedQueryCached(args.query) : null;
  const { rows } = await getPool().query<RecalledMemory>(
    `SELECT * FROM recall_memories($1, $2, $3::vector, $4, $5, 30, 0.6, 0.25, 0.15, $6)`,
    [
      args.characterId,
      args.userId,
      emb ? toVectorLiteral(emb.vector) : null,
      args.limit ?? 12,
      args.sessionId ?? null,
      args.log !== false,
    ],
  );
  return rows;
}

export async function currentIdentity(userId: string, characterId: string): Promise<IdentityCore | null> {
  const { rows } = await getPool().query<IdentityCore>(
    `SELECT * FROM character_identity_current WHERE user_id = $1 AND character_id = $2`,
    [userId, characterId],
  );
  return rows[0] || null;
}

export async function appendIdentityVersion(args: {
  userId: string;
  characterId: string;
  name: string;
  personalityMatrix?: Record<string, unknown> | null;
  voice?: Record<string, unknown> | null;
  coreTraits?: unknown[] | null;
  relationships?: Record<string, unknown> | null;
  backstory?: string | null;
  source?: string;
  changeNote?: string;
}): Promise<IdentityCore> {
  const j = (v: unknown) => (v == null ? null : JSON.stringify(v));
  const { rows } = await getPool().query<IdentityCore>(
    `SELECT * FROM append_identity_version($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)`,
    [
      args.userId,
      args.characterId,
      args.name,
      j(args.personalityMatrix),
      j(args.voice),
      j(args.coreTraits),
      j(args.relationships),
      args.backstory ?? null,
      args.source || "app",
      args.changeNote || "",
    ],
  );
  const row = rows[0];
  await appendMemoryEvent(
    {
      userId: args.userId,
      characterId: args.characterId,
      eventType: "identity_changed",
      content: `Identity updated to v${row.version}${args.changeNote ? `: ${args.changeNote}` : ""}`,
      payload: { version: row.version, source: args.source || "app" },
      emotionalWeight: 0.4,
      identityVersion: row.version,
      dedupeKey: `identity:${args.characterId}:${row.version}`,
    },
    { embed: false },
  ).catch(() => {});
  return row;
}

/**
 * Snapshot a character record into identity core v1 if none exists, so the
 * identity survives even if the user_entities JSON is later lost.
 */
export async function ensureIdentitySnapshot(
  userId: string,
  character: { id?: unknown; name?: unknown; [k: string]: unknown } | null | undefined,
): Promise<IdentityCore | null> {
  const characterId = character?.id != null ? String(character.id) : "";
  if (!characterId) return null;
  const existing = await currentIdentity(userId, characterId);
  if (existing) return existing;
  const c = character as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (c[k] != null && c[k] !== "") out[k] = c[k];
    return out;
  };
  return appendIdentityVersion({
    userId,
    characterId,
    name: String(c.name || "Companion"),
    personalityMatrix: pick("personality", "personality_matrix", "lover_matrix", "traits", "temperament", "archetype", "selected_mode"),
    voice: pick("voice", "voice_id", "speech_style", "speaking_style", "voice_anchors"),
    coreTraits: Array.isArray(c.core_traits) ? (c.core_traits as unknown[]) : Array.isArray(c.tags) ? (c.tags as unknown[]) : [],
    relationships: pick("relationship", "relationships", "relationship_to_user"),
    backstory: String(c.backstory || c.description || c.bio || "").slice(0, 6000),
    source: "snapshot",
    changeNote: "first snapshot from character record",
  });
}

export async function memoryHealth(userId: string, characterId: string): Promise<MemoryHealth> {
  const { rows } = await getPool().query<{ h: MemoryHealth }>(`SELECT memory_health($1, $2) AS h`, [userId, characterId]);
  const h = rows[0]?.h;
  return {
    memory_count: Number(h?.memory_count || 0),
    first_memory_at: h?.first_memory_at ?? null,
    last_memory_at: h?.last_memory_at ?? null,
    identity_version: h?.identity_version ?? null,
    last_recall_at: h?.last_recall_at ?? null,
    oldest_recent_recall: h?.oldest_recent_recall ?? null,
  };
}

export async function retractMemory(userId: string, characterId: string, eventId: string, reason: string): Promise<string | null> {
  return appendMemoryEvent(
    {
      userId,
      characterId,
      eventType: "retraction",
      content: `Retracted memory ${eventId}${reason ? `: ${reason}` : ""}`,
      payload: { target_event_id: eventId, reason },
      emotionalWeight: 0,
      dedupeKey: `retract:${eventId}`,
    },
    { embed: false },
  );
}
