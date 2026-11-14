/**
 * Cyberworld journey memory: validate and append journey events, and load
 * interest hints for destination choice. SQL type:
 * supabase/migrations/20261114010000_cyberworld_journey_memory.sql
 */
import { getPool } from "@workspace/db";
import { characterOwnedBy } from "./characterOwnedBy";

export const JOURNEY_EVENT_TYPE = "cyberworld_journey";
export const JOURNEY_SOURCE = "cyberworld";
export const JOURNEY_BATCH_MAX = 20;
export const JOURNEY_DAILY_LIMIT_DEFAULT = 5;
export const JOURNEY_DEDUPE_PREFIX = "journey:";

const MOTIVES = new Set(["rest", "curiosity", "social", "creativity"]);
const PAYLOAD_ID_KEYS = ["area_id", "target_id", "journey_event_id"] as const;
const CHAR_ID = /^[A-Za-z0-9_-]+$/;
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "was", "were", "this", "that",
  "with", "from", "have", "been", "they", "them", "will", "your", "about",
  "because", "just", "like", "into", "than", "then", "when", "what", "there",
  "their", "would", "could", "should", "went", "because", "she", "him", "her",
  "his", "its", "our", "out", "all", "had", "has", "who", "how", "why", "did",
]);

export type JourneyRejected = { index: number; reason: string };

export type JourneyInsertResult =
  | { ok: true; inserted: number; duplicates: number; rejected: JourneyRejected[] }
  | { ok: false; status: 400 | 401 | 404 | 429; body: Record<string, unknown> };

export type ValidJourneyRow = {
  index: number;
  characterId: string;
  content: string;
  payload: Record<string, unknown>;
  emotionalWeight: number;
  dedupeKey: string;
  occurredAt: string;
};

export type JourneyInterestMemory = {
  content: string;
  event_type: string;
  occurred_at: string;
};

export type JourneyInterests = {
  character_id: string;
  topics: string[];
  source: "chat" | "memory" | "mixed";
  memories: JourneyInterestMemory[];
};

export function isMockId(value: string): boolean {
  return value.startsWith("mock-");
}

export function journeyDailyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ANIMA_JOURNEY_EVENTS_DAILY_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || raw === undefined || raw === "") return JOURNEY_DAILY_LIMIT_DEFAULT;
  return Math.min(100, Math.max(0, Math.floor(n)));
}

export function secondsUntilUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function asString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

function isMissingRelation(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === "42P01" || e?.code === "42703";
}

/** Validate one toMemoryEventRow-shaped object (user_id ignored). */
export function validateJourneyEventRow(raw: unknown, index: number): { row: ValidJourneyRow } | { rejected: JourneyRejected } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { rejected: { index, reason: "invalid_row" } };
  }
  const b = raw as Record<string, unknown>;
  const characterId = asString(b.character_id, 120);
  if (!characterId || !CHAR_ID.test(characterId)) {
    return { rejected: { index, reason: "invalid_character_id" } };
  }
  if (isMockId(characterId)) {
    return { rejected: { index, reason: "mock_id" } };
  }
  if (b.event_type !== JOURNEY_EVENT_TYPE) {
    return { rejected: { index, reason: "invalid_event_type" } };
  }
  if (b.source !== undefined && b.source !== JOURNEY_SOURCE) {
    return { rejected: { index, reason: "invalid_source" } };
  }
  const content = asString(b.content, 4000);
  if (!content) {
    return { rejected: { index, reason: "missing_content" } };
  }
  const payload = b.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { rejected: { index, reason: "invalid_payload" } };
  }
  const p = payload as Record<string, unknown>;
  if (p.kind !== "journey") {
    return { rejected: { index, reason: "invalid_payload" } };
  }
  const areaId = asString(p.area_id, 200);
  const targetId = asString(p.target_id, 200);
  const activity = asString(p.activity, 400);
  const reason = asString(p.reason, 400);
  const motive = asString(p.motive, 40);
  const journeyEventId = asString(p.journey_event_id, 200);
  if (!areaId || !targetId || !activity || !reason || !motive || !journeyEventId || !MOTIVES.has(motive)) {
    return { rejected: { index, reason: "invalid_payload" } };
  }
  for (const key of PAYLOAD_ID_KEYS) {
    const id = String(p[key] ?? "");
    if (isMockId(id)) return { rejected: { index, reason: "mock_id" } };
  }
  const dedupeKey = asString(b.dedupe_key, 220);
  if (!dedupeKey || !dedupeKey.startsWith(JOURNEY_DEDUPE_PREFIX) || dedupeKey !== `${JOURNEY_DEDUPE_PREFIX}${journeyEventId}`) {
    return { rejected: { index, reason: "invalid_dedupe_key" } };
  }
  if (isMockId(journeyEventId) || isMockId(dedupeKey.slice(JOURNEY_DEDUPE_PREFIX.length))) {
    return { rejected: { index, reason: "mock_id" } };
  }
  let occurredAt: string;
  if (b.occurred_at === undefined || b.occurred_at === null) {
    occurredAt = new Date().toISOString();
  } else if (typeof b.occurred_at !== "string" || !Number.isFinite(Date.parse(b.occurred_at))) {
    return { rejected: { index, reason: "invalid_occurred_at" } };
  } else {
    occurredAt = new Date(b.occurred_at).toISOString();
  }
  let emotionalWeight: number;
  if (b.emotional_weight === undefined || b.emotional_weight === null) {
    emotionalWeight = motive === "social" ? 0.3 : 0.2;
  } else if (typeof b.emotional_weight !== "number" || !Number.isFinite(b.emotional_weight) || b.emotional_weight < 0 || b.emotional_weight > 1) {
    return { rejected: { index, reason: "invalid_emotional_weight" } };
  } else {
    emotionalWeight = b.emotional_weight;
  }
  return {
    row: {
      index,
      characterId,
      content,
      payload: {
        kind: "journey",
        area_id: areaId,
        target_id: targetId,
        activity,
        reason,
        motive,
        journey_event_id: journeyEventId,
      },
      emotionalWeight,
      dedupeKey,
      occurredAt,
    },
  };
}

export function parseJourneyEventBatch(body: unknown): { events: unknown[] } | { error: string; code: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "events array is required", code: "invalid_body" };
  }
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    return { error: "events array is required", code: "invalid_body" };
  }
  if (events.length > JOURNEY_BATCH_MAX) {
    return { error: `events must have at most ${JOURNEY_BATCH_MAX} rows`, code: "batch_too_large" };
  }
  return { events };
}

async function existingDedupeKeys(userId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { rows } = await getPool().query<{ dedupe_key: string }>(
    `SELECT dedupe_key FROM memory_events
      WHERE user_id = $1 AND dedupe_key = ANY($2::text[])`,
    [userId, keys],
  );
  return new Set(rows.map((r) => r.dedupe_key));
}

async function usedTodayByCharacter(userId: string, characterIds: string[]): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  if (!characterIds.length) return used;
  const { rows } = await getPool().query<{ character_id: string; n: number }>(
    `SELECT character_id, count(*)::int AS n
       FROM memory_events
      WHERE user_id = $1
        AND character_id = ANY($2::text[])
        AND event_type = $3
        AND inserted_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'
      GROUP BY character_id`,
    [userId, characterIds, JOURNEY_EVENT_TYPE],
  );
  for (const r of rows) used.set(r.character_id, r.n);
  return used;
}

/** Insert a batch of journey events for the session user. user_id in the body is ignored. */
export async function insertJourneyEvents(userId: string, body: unknown, env: NodeJS.ProcessEnv = process.env): Promise<JourneyInsertResult> {
  if (!userId) {
    return { ok: false, status: 401, body: { error: "Unauthorized" } };
  }
  const parsed = parseJourneyEventBatch(body);
  if ("error" in parsed) {
    return { ok: false, status: 400, body: { error: parsed.error, code: parsed.code } };
  }

  const rejected: JourneyRejected[] = [];
  const valid: ValidJourneyRow[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < parsed.events.length; i++) {
    const out = validateJourneyEventRow(parsed.events[i], i);
    if ("rejected" in out) {
      rejected.push(out.rejected);
      continue;
    }
    // A second copy of the same key in one batch is a duplicate, not a second insert.
    if (seenKeys.has(out.row.dedupeKey)) {
      rejected.push({ index: i, reason: "duplicate_in_batch" });
      continue;
    }
    seenKeys.add(out.row.dedupeKey);
    valid.push(out.row);
  }

  const characterIds = [...new Set(valid.map((r) => r.characterId))];
  for (const id of characterIds) {
    if (!(await characterOwnedBy(userId, id))) {
      return { ok: false, status: 404, body: { error: "Companion not found", code: "companion_not_found" } };
    }
  }

  const existing = await existingDedupeKeys(userId, valid.map((r) => r.dedupeKey));
  const duplicates = valid.filter((r) => existing.has(r.dedupeKey));
  const toInsert = valid.filter((r) => !existing.has(r.dedupeKey));

  const limit = journeyDailyLimit(env);
  const used = await usedTodayByCharacter(userId, [...new Set(toInsert.map((r) => r.characterId))]);
  const pending = new Map<string, number>();
  for (const row of toInsert) pending.set(row.characterId, (pending.get(row.characterId) || 0) + 1);
  for (const [characterId, n] of pending) {
    if ((used.get(characterId) || 0) + n > limit) {
      return {
        ok: false,
        status: 429,
        body: {
          error: "rate_limited",
          code: "rate_limited",
          retry_after: secondsUntilUtcMidnight(),
          character_id: characterId,
          limit,
        },
      };
    }
  }

  let inserted = 0;
  for (const row of toInsert) {
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO memory_events
         (user_id, character_id, conversation_id, message_id, event_type, content, payload,
          emotional_weight, dedupe_key, source, occurred_at)
       VALUES ($1,$2,NULL,NULL,$3,$4,$5::jsonb,$6,$7,$8,$9::timestamptz)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        userId,
        row.characterId,
        JOURNEY_EVENT_TYPE,
        row.content,
        JSON.stringify(row.payload),
        row.emotionalWeight,
        row.dedupeKey,
        JOURNEY_SOURCE,
        row.occurredAt,
      ],
    );
    if (rows[0]?.id) inserted += 1;
    else duplicates.push(row);
  }

  return {
    ok: true,
    inserted,
    duplicates: duplicates.length,
    rejected,
  };
}

function topicTokens(text: string): string[] {
  const found = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
  return found.filter((w) => !STOP_WORDS.has(w) && !isMockId(w));
}

async function recentMemories(userId: string, characterId: string, limit = 8): Promise<Array<JourneyInterestMemory & { payload: Record<string, unknown> }>> {
  try {
    const { rows } = await getPool().query<{ content: string; event_type: string; occurred_at: Date | string; payload: Record<string, unknown> }>(
      `SELECT content, event_type, occurred_at, payload
         FROM memory_events
        WHERE user_id = $1 AND character_id = $2
          AND event_type NOT IN ('recall', 'retraction', 'memory_corrupted', 'memory_restored')
        ORDER BY occurred_at DESC
        LIMIT $3`,
      [userId, characterId, limit],
    );
    return rows.map((r) => ({
      content: r.content,
      event_type: r.event_type,
      occurred_at: typeof r.occurred_at === "string" ? r.occurred_at : r.occurred_at.toISOString(),
      payload: r.payload && typeof r.payload === "object" ? r.payload : {},
    }));
  } catch (err) {
    if (isMissingRelation(err)) return [];
    throw err;
  }
}

async function recentChatTexts(userId: string, characterId: string, limit = 20): Promise<string[]> {
  try {
    const { rows } = await getPool().query<{ content: string }>(
      `SELECT content FROM chat_messages
        WHERE user_id = $1 AND character_id = $2 AND role = 'user'
        ORDER BY created_at DESC
        LIMIT $3`,
      [userId, characterId, limit],
    );
    return rows.map((r) => r.content);
  } catch (err) {
    if (isMissingRelation(err)) return [];
    throw err;
  }
}

/** Owner-scoped interest hints: recent memories plus cheap topics from chat and memory text. */
export async function loadJourneyInterests(userId: string, characterId: string): Promise<JourneyInterests | { status: 400 | 404; body: Record<string, unknown> }> {
  const id = String(characterId || "").trim();
  if (!id || id.length > 120 || !CHAR_ID.test(id)) {
    return { status: 400, body: { error: "character_id required", code: "invalid_character_id" } };
  }
  if (!(await characterOwnedBy(userId, id))) {
    return { status: 404, body: { error: "Companion not found", code: "companion_not_found" } };
  }

  const [memories, chats] = await Promise.all([recentMemories(userId, id), recentChatTexts(userId, id)]);
  const topics: string[] = [];
  const seen = new Set<string>();
  const add = (words: string[]) => {
    for (const w of words) {
      if (seen.has(w) || topics.length >= 12) continue;
      seen.add(w);
      topics.push(w);
    }
  };
  for (const m of memories) {
    const p = m.payload;
    if (typeof p.motive === "string") add([p.motive.toLowerCase()]);
    if (typeof p.activity === "string") add(topicTokens(p.activity));
    if (typeof p.reason === "string") add(topicTokens(p.reason));
    add(topicTokens(m.content));
  }
  const chatTopics: string[] = [];
  const chatSeen = new Set<string>();
  for (const text of chats) {
    for (const w of topicTokens(text)) {
      if (chatSeen.has(w) || chatTopics.length >= 12) continue;
      chatSeen.add(w);
      chatTopics.push(w);
    }
  }
  // Prefer memory-derived topics, then fill from recent user chat.
  add(chatTopics);

  const source: JourneyInterests["source"] = memories.length && chats.length ? "mixed" : chats.length ? "chat" : "memory";
  return {
    character_id: id,
    topics,
    source,
    memories: memories.map(({ content, event_type, occurred_at }) => ({ content, event_type, occurred_at })),
  };
}
