/**
 * Net-battle persistence + validation (supabase/migrations/20261022200000_immersive_sim.sql).
 * The client plays optimistically with @workspace/sim-core; the server replays the
 * append-only input log with the same engine and only records consequences the
 * replay produced. Memory corruption/restoration are appended memory_events.
 */
import { randomInt } from "node:crypto";
import { getPool } from "@workspace/db";
import {
  bandAt,
  LAYER_W,
  validateLog,
  type BandKey,
  type EmittedEvent,
  type SimConfig,
  type StampedAction,
} from "@workspace/sim-core";
import { appendMemoryEvent } from "../memoryCore/memoryCore";

export const CORRUPTION_TTL_DAYS = 7;
const VIRUS_KINDS = ["mettaur", "shade", "static", "halo", "aegis"] as const;

export class SimError extends Error {
  constructor(message: string, public status = 400, public code = "sim_error") {
    super(message);
  }
}

export type SimSessionRow = {
  id: string;
  user_id: string;
  character_id: string;
  node_id: string | null;
  config: SimConfig;
  outcome: string | null;
  final_tick: number | null;
  final_hash: string | null;
  created_at: string;
  ended_at: string | null;
};

/** Enemy roster for a node: its band sets the home W layer; hostile = 2 viruses. */
export function enemiesForNode(args: { frequency?: number | null; signalType?: string | null; seed: number }): SimConfig["enemies"] {
  const freq = Number.isFinite(args.frequency) ? Number(args.frequency) : 10;
  const home = bandAt(freq).key;
  const kind = VIRUS_KINDS[args.seed % VIRUS_KINDS.length];
  const enemies: SimConfig["enemies"] = [{ kind, band: home, w: LAYER_W[bandAt(freq).index], hp: 140 }];
  if (args.signalType === "hostile") {
    const second: BandKey = home === "noise" ? "ambient" : "noise";
    enemies.push({ kind: VIRUS_KINDS[(args.seed >>> 3) % VIRUS_KINDS.length], band: second, hp: 100 });
  }
  return enemies;
}

async function memoryPoolFor(userId: string, characterId: string): Promise<string[]> {
  try {
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM memory_events
        WHERE user_id = $1 AND character_id = $2
          AND event_type NOT IN ('recall','retraction','memory_corrupted','memory_restored','battle_outcome')
        ORDER BY occurred_at DESC LIMIT 12`,
      [userId, characterId],
    );
    return rows.map((r) => r.id);
  } catch {
    return []; // memory core not migrated: battle still works, nothing can be corrupted
  }
}

export async function createSimSession(
  userId: string,
  body: { character_id?: unknown; node_id?: unknown; start_w?: unknown },
): Promise<{ session: SimSessionRow }> {
  const characterId = String(body.character_id || "").trim().slice(0, 128);
  if (!characterId) throw new SimError("character_id is required");
  const nodeId = typeof body.node_id === "string" && /^[0-9a-f-]{36}$/i.test(body.node_id) ? body.node_id : null;
  const pool = getPool();
  let node: { frequency: number; signal_type: string } | null = null;
  if (nodeId) {
    const r = await pool.query<{ frequency: number; signal_type: string }>(
      `SELECT frequency, signal_type FROM resonance_nodes WHERE id = $1 AND (user_id IS NULL OR user_id = $2) AND retired_at IS NULL`,
      [nodeId, userId],
    );
    node = r.rows[0] || null;
    if (!node) throw new SimError("Node not found", 404, "node_not_found");
  }
  const seed = randomInt(1, 2 ** 31 - 1);
  const startW = Number.isFinite(Number(body.start_w)) ? Math.min(100, Math.max(0, Number(body.start_w))) : 94;
  const config: SimConfig = {
    seed,
    companionId: characterId,
    startW,
    enemies: enemiesForNode({ frequency: node?.frequency, signalType: node?.signal_type, seed }),
    memoryPool: await memoryPoolFor(userId, characterId),
  };
  const { rows } = await pool.query<SimSessionRow>(
    `INSERT INTO sim_sessions (user_id, character_id, node_id, config) VALUES ($1,$2,$3,$4::jsonb) RETURNING *`,
    [userId, characterId, nodeId, JSON.stringify(config)],
  );
  return { session: rows[0] };
}

async function loadSession(userId: string, id: string): Promise<SimSessionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SimError("Session not found", 404, "session_not_found");
  const { rows } = await getPool().query<SimSessionRow>(`SELECT * FROM sim_sessions WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!rows[0]) throw new SimError("Session not found", 404, "session_not_found");
  return rows[0];
}

async function loadActions(sessionId: string): Promise<StampedAction[]> {
  const { rows } = await getPool().query<{ tick: number; action: StampedAction["action"] }>(
    `SELECT tick, action FROM sim_actions WHERE session_id = $1 ORDER BY idx ASC`,
    [sessionId],
  );
  return rows.map((r) => ({ tick: r.tick, action: r.action }));
}

export async function getSimSession(userId: string, id: string) {
  const session = await loadSession(userId, id);
  return { session, actions: await loadActions(id) };
}

/** Turn replay-produced consequences into appended memory events (idempotent via dedupe keys). */
export async function recordConsequences(session: SimSessionRow, consequences: EmittedEvent[]): Promise<number> {
  let written = 0;
  const expires = new Date(Date.now() + CORRUPTION_TTL_DAYS * 86_400_000).toISOString();
  for (const e of consequences) {
    let id: string | null = null;
    if (e.type === "memory_corrupted") {
      id = await appendMemoryEvent(
        {
          userId: session.user_id,
          characterId: session.character_id,
          eventType: "memory_corrupted",
          content: `A memory's signal was corrupted in a net battle (${e.band} band interference).`,
          payload: { target_event_id: e.targetEventId, severity: e.severity, band: e.band, sim_session_id: session.id, tick: e.tick, expires_at: expires },
          emotionalWeight: 0.3,
          dedupeKey: `sim:${session.id}:corrupt:${e.targetEventId}:${e.tick}`,
          source: "sim",
        },
        { embed: false },
      );
    } else if (e.type === "memory_restored") {
      id = await appendMemoryEvent(
        {
          userId: session.user_id,
          characterId: session.character_id,
          eventType: "memory_restored",
          content: "A corrupted memory was purified and is clear again.",
          payload: { target_event_id: e.targetEventId, sim_session_id: session.id, tick: e.tick },
          emotionalWeight: 0.45,
          dedupeKey: `sim:${session.id}:restore:${e.targetEventId}:${e.tick}`,
          source: "sim",
        },
        { embed: false },
      );
    } else if (e.type === "battle_end") {
      id = await appendMemoryEvent({
        userId: session.user_id,
        characterId: session.character_id,
        eventType: "battle_outcome",
        content: e.outcome === "win" ? "We won a net battle together on the resonance grid." : "We were forced out of a net battle on the resonance grid.",
        payload: { outcome: e.outcome, sim_session_id: session.id, node_id: session.node_id, tick: e.tick },
        emotionalWeight: e.outcome === "win" ? 0.6 : 0.5,
        dedupeKey: `sim:${session.id}:outcome`,
        source: "sim",
      });
    }
    if (id) written++;
  }
  return written;
}

/**
 * Append a batch of inputs. `from_idx` must equal the number of stored actions
 * (strict append); re-sending an already stored prefix is accepted as a retry.
 */
export async function appendSimActions(
  userId: string,
  id: string,
  body: { from_idx?: unknown; actions?: unknown; claimed?: { tick?: unknown; hash?: unknown } },
) {
  const session = await loadSession(userId, id);
  if (session.outcome) throw new SimError("Battle already finished", 409, "sim_finished");
  const existing = await loadActions(id);
  const from = Number(body.from_idx);
  const batch = Array.isArray(body.actions) ? (body.actions as StampedAction[]) : [];
  if (!Number.isInteger(from) || from < 0 || from > existing.length) throw new SimError("from_idx out of range", 409, "sim_desync");
  const overlap = batch.slice(0, existing.length - from);
  if (JSON.stringify(overlap) !== JSON.stringify(existing.slice(from, from + overlap.length))) {
    throw new SimError("Input log diverges from the stored log", 409, "sim_desync");
  }
  const fresh = batch.slice(overlap.length);
  const all = [...existing, ...fresh];
  const claimed =
    body.claimed && Number.isInteger(Number(body.claimed.tick)) && typeof body.claimed.hash === "string"
      ? { tick: Number(body.claimed.tick), hash: body.claimed.hash }
      : undefined;
  const v = validateLog(session.config, all, claimed);
  if (!v.ok) throw new SimError(`Rejected: ${v.reason}`, 409, "sim_rejected");

  // One statement = atomic without a driver transaction (works on the Worker driver too).
  const rows = fresh.map((a, i) => ({ idx: existing.length + i, tick: a.tick, action: a.action }));
  try {
    await getPool().query(
      `WITH a AS (
         INSERT INTO sim_actions (session_id, idx, tick, action)
         SELECT $1::uuid, (x->>'idx')::int, (x->>'tick')::int, x->'action' FROM jsonb_array_elements($2::jsonb) x
         RETURNING 1),
       snap AS (
         INSERT INTO sim_arena_snapshots (session_id, tick, action_count, state_hash, state)
         VALUES ($1::uuid, $3, $4, $5, $6::jsonb) RETURNING 1),
       fin AS (
         UPDATE sim_sessions SET outcome = $7, final_tick = $3, final_hash = $5, ended_at = now()
          WHERE id = $1::uuid AND outcome IS NULL AND $7::text IS NOT NULL RETURNING 1)
       SELECT (SELECT count(*) FROM a) AS inserted`,
      [id, JSON.stringify(rows), v.state.tick, all.length, v.hash, JSON.stringify(v.state), v.state.outcome],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new SimError("Concurrent append", 409, "sim_desync");
    throw err;
  }

  let memoryEvents = 0;
  try {
    memoryEvents = await recordConsequences(session, v.consequences);
  } catch (err) {
    // Memory core missing/unavailable: the battle record stands; consequences are
    // re-derived (dedupe-keyed) on the next accepted batch.
    console.error("sim: memory consequence write failed", err);
  }
  return {
    accepted: fresh.length,
    action_count: all.length,
    tick: v.state.tick,
    hash: v.hash,
    outcome: v.state.outcome,
    memory_events: memoryEvents,
    corruptions: v.state.corruptions,
  };
}
