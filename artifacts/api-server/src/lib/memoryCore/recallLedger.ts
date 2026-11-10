/**
 * "Why she said that" recall ledger (read-only).
 *
 * Reads memory_recalls (the append-only log written by SQL recall_memories,
 * supabase/migrations/20261022280000_continuity.sql) joined to memory_events,
 * filtered by user_id AND character_id on BOTH tables. Never calls
 * recallMemories / ensureIdentitySnapshot / embeddings, and never writes.
 *
 * What the data can and cannot prove (docs/recall-ledger.md):
 *  - memory_recalls has no turn/message id. Rows written by one
 *    recall_memories call share (session_id, recalled_at) because recalled_at
 *    defaults to now() (transaction start), so the ledger groups them into a
 *    "recall batch". A batch is one recall call, not a proven chat turn.
 *  - A logged recall was a candidate returned by recall_memories. The prompt
 *    builders may still trim it (char/token budgets, timeouts), so a row is
 *    not proof the memory reached the prompt.
 *  - Legacy companion_memories facts (F-01, not speaker-attributed) are never
 *    read here.
 */
import { obscuredMemory } from "@workspace/sim-core";
import { getPool } from "@workspace/db";

export const RECALL_LEDGER_DEFAULT_LIMIT = 10;
export const RECALL_LEDGER_MAX_LIMIT = 25;
/** recall_memories caps one call at 50 rows; the ledger never returns more per batch. */
export const RECALL_LEDGER_MAX_PER_BATCH = 50;
const PREVIEW_CHARS = 280;
const NON_MEMORY_TYPES = ["recall", "retraction", "memory_corrupted", "memory_restored"];

export type RecallLedgerEntry = {
  recall_id: string;
  rank: number;
  score: number;
  similarity: number | null;
  recency: number | null;
  emotional_weight: number;
  memory_age_s: number;
  memory: {
    event_id: string;
    event_type: string;
    content_preview: string;
    occurred_at: string;
    conversation_id: string | null;
    source_turn_id: string | null;
    corrupted: boolean;
  };
};

export type RecallLedgerBatch = {
  batch_id: string;
  recalled_at: string;
  session_id: string | null;
  turn_id: null;
  recalls: RecallLedgerEntry[];
  withheld: { retracted: number; unattributable: number };
};

export type RecallLedgerPage = {
  character_id: string;
  batches: RecallLedgerBatch[];
  next_cursor: string | null;
  meta: {
    limit: number;
    max_limit: number;
    turn_linkage: "none";
    grouping: "session_id+recalled_at";
  };
};

export class RecallLedgerCursorError extends Error {
  code = "invalid_cursor";
}

type Cursor = { t: string; s: string | null };

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

export function encodeRecallCursor(c: Cursor): string {
  return b64url(JSON.stringify({ v: 1, t: c.t, s: c.s }));
}

export function decodeRecallCursor(raw: string): Cursor {
  try {
    if (raw.length > 600) throw new Error("too long");
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { v?: unknown; t?: unknown; s?: unknown };
    if (o?.v !== 1 || typeof o.t !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(o.t)) {
      throw new Error("bad shape");
    }
    if (o.s !== null && (typeof o.s !== "string" || o.s.length > 200)) throw new Error("bad session");
    if (Number.isNaN(Date.parse(o.t))) throw new Error("bad time");
    return { t: o.t, s: o.s as string | null };
  } catch {
    throw new RecallLedgerCursorError("Invalid cursor");
  }
}

export function clampLedgerLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || raw === undefined || raw === null || raw === "") return RECALL_LEDGER_DEFAULT_LIMIT;
  return Math.min(RECALL_LEDGER_MAX_LIMIT, Math.max(1, n));
}

/** Owner check: the character must be the signed-in user's Character or Anima row. */
export async function characterOwnedBy(userId: string, characterId: string): Promise<boolean> {
  if (!userId || !characterId) return false;
  const { rows } = await getPool().query(
    `SELECT 1 FROM user_entities
      WHERE user_id = $1 AND entity_name IN ('Character', 'Anima') AND entity_id = $2
      LIMIT 1`,
    [userId, characterId],
  );
  return rows.length > 0;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function round(n: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function preview(content: string, corrupted: { severity: number } | null, eventId: string): string {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  // Same treatment the prompt applies (sessionContext.formatMemoryCoreBlock):
  // a currently corrupted memory is shown only as an obscured fragment.
  const shown = corrupted ? obscuredMemory(text, corrupted.severity, eventId) : text;
  return shown.length > PREVIEW_CHARS ? `${shown.slice(0, PREVIEW_CHARS - 1)}…` : shown;
}

type BatchRow = { t: string; session_id: string | null };
type EntryRow = {
  t: string;
  session_id: string | null;
  recall_id: string;
  score: number;
  similarity: number | null;
  recency: number | null;
  event_age_s: number;
  event_id: string;
  ev_id: string | null;
  event_type: string | null;
  content: string | null;
  occurred_at: string | null;
  conversation_id: string | null;
  emotional_weight: number | null;
  source_turn_id: string | null;
  retracted: boolean;
  corrupt_severity: number | null;
};

const TS = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * One page of recall batches for (userId, characterId), newest first.
 * Callers MUST verify ownership first (characterOwnedBy); this function also
 * filters every table by both ids so a missed check can't cross characters.
 */
export async function listRecallLedger(args: {
  userId: string;
  characterId: string;
  limit?: number;
  cursor?: string | null;
  sessionId?: string | null;
}): Promise<RecallLedgerPage> {
  const limit = clampLedgerLimit(args.limit);
  const cursor = args.cursor ? decodeRecallCursor(args.cursor) : null;
  const sessionId = args.sessionId ?? null;
  const pool = getPool();

  const params: unknown[] = [args.userId, args.characterId];
  const where = [`r.user_id = $1`, `r.character_id = $2`];
  if (sessionId !== null) {
    params.push(sessionId);
    where.push(`r.session_id = $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.t, cursor.s ?? "");
    where.push(
      `(r.recalled_at < $${params.length - 1}::timestamptz
        OR (r.recalled_at = $${params.length - 1}::timestamptz AND COALESCE(r.session_id, '') < $${params.length}))`,
    );
  }
  params.push(limit + 1);
  const { rows: batchRows } = await pool.query<BatchRow>(
    `SELECT ${TS.replace("%s", "r.recalled_at")} AS t, r.session_id
       FROM memory_recalls r
      WHERE ${where.join(" AND ")}
      GROUP BY r.recalled_at, r.session_id
      ORDER BY r.recalled_at DESC, COALESCE(r.session_id, '') DESC
      LIMIT $${params.length}`,
    params,
  );

  const hasMore = batchRows.length > limit;
  const pageBatches = batchRows.slice(0, limit);
  if (!pageBatches.length) {
    return { character_id: args.characterId, batches: [], next_cursor: null, meta: metaFor(limit) };
  }

  const times = pageBatches.map((b) => b.t);
  const sessions = pageBatches.map((b) => b.session_id ?? "");
  const { rows } = await pool.query<EntryRow>(
    `WITH page AS (
       SELECT t::timestamptz AS recalled_at, NULLIF(s, '') AS session_id
         FROM unnest($3::text[], $4::text[]) AS u(t, s)
     ),
     hits AS (
       SELECT r.*,
              row_number() OVER (PARTITION BY r.recalled_at, r.session_id ORDER BY r.score DESC, r.id) AS rn
         FROM memory_recalls r
         JOIN page p ON p.recalled_at = r.recalled_at AND p.session_id IS NOT DISTINCT FROM r.session_id
        WHERE r.user_id = $1 AND r.character_id = $2
     )
     SELECT ${TS.replace("%s", "h.recalled_at")} AS t,
            h.session_id, h.id AS recall_id, h.score, h.similarity, h.recency, h.event_age_s, h.event_id,
            e.id AS ev_id, e.event_type, e.content, ${TS.replace("%s", "e.occurred_at")} AS occurred_at,
            e.conversation_id, e.emotional_weight,
            CASE WHEN e.event_type = 'turn' THEN e.payload ->> 'turn_id' END AS source_turn_id,
            EXISTS (
              SELECT 1 FROM memory_events x
               WHERE x.event_type = 'retraction'
                 AND x.user_id = $1
                 AND x.payload ->> 'target_event_id' = h.event_id::text
            ) AS retracted,
            (SELECT mc.severity FROM memory_corruption_active mc
              WHERE mc.user_id = $1 AND mc.character_id = $2 AND mc.target_event_id = h.event_id
              LIMIT 1) AS corrupt_severity
       FROM hits h
       LEFT JOIN memory_events e
         ON e.id = h.event_id
        AND e.user_id = $1
        AND e.character_id = $2
        AND e.event_type <> ALL($5::text[])
      WHERE h.rn <= ${RECALL_LEDGER_MAX_PER_BATCH}
      ORDER BY h.recalled_at DESC, COALESCE(h.session_id, '') DESC, h.score DESC, h.id`,
    [args.userId, args.characterId, times, sessions, NON_MEMORY_TYPES],
  );

  const byKey = new Map<string, RecallLedgerBatch>();
  for (const b of pageBatches) {
    const key = `${b.t}|${b.session_id ?? ""}`;
    byKey.set(key, {
      batch_id: encodeRecallCursor({ t: b.t, s: b.session_id }),
      recalled_at: b.t,
      session_id: b.session_id,
      turn_id: null,
      recalls: [],
      withheld: { retracted: 0, unattributable: 0 },
    });
  }
  for (const r of rows) {
    const batch = byKey.get(`${r.t}|${r.session_id ?? ""}`);
    if (!batch) continue;
    // Unattributable: the recalled event is missing, belongs to another
    // user/character, or is bookkeeping. Never shown, only counted.
    if (!r.ev_id || r.event_type === null || r.content === null) {
      batch.withheld.unattributable += 1;
      continue;
    }
    if (r.retracted) {
      batch.withheld.retracted += 1;
      continue;
    }
    const corrupted = r.corrupt_severity === null ? null : { severity: num(r.corrupt_severity) || 0.5 };
    batch.recalls.push({
      recall_id: r.recall_id,
      rank: batch.recalls.length + 1,
      score: round(num(r.score)),
      similarity: numOrNull(r.similarity) === null ? null : round(num(r.similarity)),
      recency: numOrNull(r.recency) === null ? null : round(num(r.recency)),
      emotional_weight: round(num(r.emotional_weight)),
      memory_age_s: Math.max(0, Math.round(num(r.event_age_s))),
      memory: {
        event_id: r.event_id,
        event_type: r.event_type,
        content_preview: preview(r.content, corrupted, r.event_id),
        occurred_at: r.occurred_at as string,
        conversation_id: r.conversation_id,
        source_turn_id: typeof r.source_turn_id === "string" && r.source_turn_id ? r.source_turn_id.slice(0, 200) : null,
        corrupted: Boolean(corrupted),
      },
    });
  }

  const last = pageBatches[pageBatches.length - 1];
  return {
    character_id: args.characterId,
    batches: [...byKey.values()],
    next_cursor: hasMore ? encodeRecallCursor({ t: last.t, s: last.session_id }) : null,
    meta: metaFor(limit),
  };
}

function metaFor(limit: number): RecallLedgerPage["meta"] {
  return {
    limit,
    max_limit: RECALL_LEDGER_MAX_LIMIT,
    turn_linkage: "none",
    grouping: "session_id+recalled_at",
  };
}
