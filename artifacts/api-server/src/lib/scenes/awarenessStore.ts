/**
 * Situational scenes (#763) PR 2: awareness persistence. Every helper here is
 * called only when ANIMA_SITUATIONAL_SCENES is on, from inside the caller's
 * transaction after it took the per-session lock (migrateSessionMessages), so
 * a stamp, a tombstone and the row write are one atomic step.
 */
import { and, eq, sql } from "drizzle-orm";
import { asObject, chatSessions, chatTurns, db, type MsgData } from "@workspace/db";
import { effectiveScene, normalizeStoredScene, type SceneState } from "./sceneState";
import { loadSceneSession, SceneOwnershipError, type SceneSessionInfo } from "./sceneStore";
import {
  claimsAwareness,
  liveTombstones,
  restoredHeardBy,
  stampHeardBy,
  tombstoneFor,
  withHeardBy,
  withTombstones,
  type AwarenessTombstone,
} from "./awareness";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

/** What a write path needs to stamp rows for one session. */
export type AwarenessScope = {
  sessionId: string;
  info: SceneSessionInfo | null;
  /** chat_sessions.metadata for this user's row ({} when there is none yet). */
  metadata: Record<string, unknown>;
  rowExists: boolean;
  hasStoredScene: boolean;
  /** The effective scene (every session character, missing ones `here`). */
  scene: SceneState;
  /** Server-stored cast (never request ids). */
  cast: string[];
  names: Map<string, string>;
  tombstones: Record<string, AwarenessTombstone>;
};

export async function loadAwarenessScope(
  executor: Executor,
  userId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<AwarenessScope> {
  const info = await loadSceneSession(userId, sessionId, executor);
  const [row] = await executor
    .select({ userId: chatSessions.userId, metadata: chatSessions.metadata })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);
  if (row && row.userId !== userId) throw new SceneOwnershipError();
  const metadata = row ? asObject(row.metadata) : {};
  const cast = info?.characterIds ?? [];
  const scene = effectiveScene(normalizeStoredScene(metadata.scene), {
    characterIds: cast,
    isGroup: info?.isGroup ?? false,
  });
  return {
    sessionId,
    info,
    metadata,
    rowExists: Boolean(row),
    hasStoredScene: metadata.scene !== undefined && metadata.scene !== null,
    scene,
    cast,
    names: info?.names ?? new Map(),
    tombstones: liveTombstones(metadata.awareness_tombstones, sessionId, now),
  };
}

const TURN_ROW_RE = /^(.+):(user|assistant)$/;

/**
 * The stamp the chat turn computed for its own user / assistant row (kept in
 * chat_turns.metadata.scene_awareness, server-written). Null when the id is
 * not a turn row of this user's session or the turn has no stamp.
 */
export async function ledgerStamp(
  executor: Executor,
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<string[] | null> {
  const match = TURN_ROW_RE.exec(messageId);
  if (!match) return null;
  const [turn] = await executor
    .select({ metadata: chatTurns.metadata, userMessageId: chatTurns.userMessageId, assistantMessageId: chatTurns.assistantMessageId })
    .from(chatTurns)
    .where(and(eq(chatTurns.id, match[1]!), eq(chatTurns.userId, userId), eq(chatTurns.sessionId, sessionId)))
    .limit(1);
  if (!turn) return null;
  const which = match[2] === "user" ? "user" : "assistant";
  if ((which === "user" ? turn.userMessageId : turn.assistantMessageId) !== messageId) return null;
  const awareness = asObject(asObject(turn.metadata).scene_awareness);
  const stamp = awareness[which];
  if (!Array.isArray(stamp) || !stamp.every((id) => typeof id === "string")) return null;
  return stamp as string[];
}

export type StampDecision = {
  row: MsgData;
  /** Tombstone ids this write consumed (removed in the same transaction). */
  consumed: string[];
};

/**
 * The awareness a NEW row gets on any write path. The client's value is never
 * read. Order: a tombstone for this id (restore rule, R1) > the turn's own
 * stamp > the current scene at write time (+ @mentioned reachable listeners,
 * + the speaker of an assistant line).
 */
export async function stampNewRow(
  executor: Executor,
  userId: string,
  scope: AwarenessScope,
  row: MsgData,
  nowIso: string,
): Promise<StampDecision> {
  const id = String(row.id ?? "");
  const tombstone = id ? scope.tombstones[id] : undefined;
  if (tombstone) {
    return { row: withHeardBy(row, restoredHeardBy(row, tombstone), nowIso), consumed: [id] };
  }
  const fromLedger = id ? await ledgerStamp(executor, userId, scope.sessionId, id) : null;
  if (fromLedger) return { row: withHeardBy(row, fromLedger.filter((x) => scope.cast.includes(x)), nowIso), consumed: [] };
  const speakerId = row.role === "assistant" ? String(row.character_id ?? asObject(row.metadata).character_id ?? "") : "";
  const stamp = stampHeardBy({ scene: scope.scene, content: row.content, names: scope.names, speakerId });
  return { row: withHeardBy(row, stamp, nowIso), consumed: [] };
}

/**
 * Awareness for a row arriving through a generic path (import, backup
 * restore) that cannot be verified: a claimed stamp is replaced by nobody,
 * and an unclaimed one stays legacy only while the session never had a scene.
 */
export function stampUnverifiedRow(scope: AwarenessScope, row: MsgData, nowIso: string): MsgData {
  if (claimsAwareness(row) || scope.hasStoredScene) return withHeardBy(row, [], nowIso);
  return row;
}

/**
 * Write the session's tombstone map (added minus consumed, capped, expired
 * dropped). Creates this user's chat_sessions row when there is none, and
 * never touches another user's row.
 */
export async function saveTombstones(
  tx: Tx,
  userId: string,
  scope: AwarenessScope,
  input: { added?: MsgData[]; consumed?: string[]; now: Date },
): Promise<void> {
  const nowIso = input.now.toISOString();
  const added = (input.added ?? []).map((row) => tombstoneFor(row, scope.sessionId, nowIso));
  if (added.length === 0 && (input.consumed ?? []).length === 0) return;
  const next = withTombstones(scope.metadata.awareness_tombstones, scope.sessionId, added, input.now);
  for (const id of input.consumed ?? []) delete next[id];
  scope.tombstones = next;
  scope.metadata = { ...scope.metadata, awareness_tombstones: next };
  if (scope.rowExists) {
    await tx
      .update(chatSessions)
      .set({ metadata: sql`${chatSessions.metadata} || jsonb_build_object('awareness_tombstones', ${JSON.stringify(next)}::jsonb)` })
      .where(and(eq(chatSessions.id, scope.sessionId), eq(chatSessions.userId, userId)));
    return;
  }
  const info = scope.info;
  const inserted = await tx
    .insert(chatSessions)
    .values({
      id: scope.sessionId,
      userId,
      mode: info?.mode || "solo",
      characterIds: info?.characterIds ?? [],
      isCrossover: info?.isCrossover ?? false,
      metadata: { awareness_tombstones: next },
    })
    .onConflictDoUpdate({
      target: chatSessions.id,
      set: {
        metadata: sql`${chatSessions.metadata} || jsonb_build_object('awareness_tombstones', ${JSON.stringify(next)}::jsonb)`,
      },
      where: eq(chatSessions.userId, userId),
    })
    .returning({ id: chatSessions.id });
  if (inserted.length === 0) throw new SceneOwnershipError();
  scope.rowExists = true;
}

/**
 * Stamp a row a server path is about to insert (turn rows, proactive and
 * outreach lines). Same rule as a client append. Inside the caller's
 * transaction, after its session lock. Flag off: the row unchanged.
 */
export async function stampServerRow(tx: Tx, userId: string, sessionId: string, row: MsgData, enabled: boolean): Promise<MsgData> {
  if (!enabled) return row;
  const scope = await loadAwarenessScope(tx, userId, sessionId);
  const stamped = await stampNewRow(tx, userId, scope, row, new Date().toISOString());
  if (stamped.consumed.length) await saveTombstones(tx, userId, scope, { consumed: stamped.consumed, now: new Date() });
  return stamped.row;
}

/** The turn's stamps (chat_turns.metadata.scene_awareness), when present and well formed. */
export type TurnAwareness = { user: string[] | null; assistant: string[] | null; cast: string[] };

export function turnAwarenessOf(metadata: unknown): TurnAwareness | null {
  const raw = asObject(asObject(metadata).scene_awareness);
  if (!Array.isArray(raw.cast)) return null;
  const list = (value: unknown): string[] | null =>
    Array.isArray(value) && value.every((id) => typeof id === "string") ? (value as string[]) : null;
  const cast = list(raw.cast) ?? [];
  // A present-but-malformed stamp fails closed (nobody).
  const user = raw.user === undefined ? null : (list(raw.user) ?? []);
  const assistant = raw.assistant === undefined ? null : (list(raw.assistant) ?? []);
  return { user, assistant, cast };
}

/**
 * Who may learn from a committed turn: per character, whether she heard the
 * user line and the reply. Without turn stamps (flag off, or a turn from
 * before scenes) everyone in `characterIds` heard both, as before.
 */
export function turnListeners(
  characterIds: string[],
  awareness: TurnAwareness | null,
): Array<{ id: string; user: boolean; reply: boolean }> {
  if (!awareness) return characterIds.map((id) => ({ id, user: true, reply: true }));
  const out: Array<{ id: string; user: boolean; reply: boolean }> = [];
  for (const id of characterIds) {
    if (!awareness.cast.includes(id)) continue;
    const user = awareness.user ? awareness.user.includes(id) : false;
    const reply = awareness.assistant ? awareness.assistant.includes(id) : false;
    if (user || reply) out.push({ id, user, reply });
  }
  return out;
}
