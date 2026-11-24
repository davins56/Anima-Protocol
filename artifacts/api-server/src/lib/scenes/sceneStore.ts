/**
 * Situational scenes (#763), persistence. The scene lives in the typed
 * chat_sessions.metadata.scene (jsonb, no migration). The generic /api/store
 * routes only write user_entities, so a client cannot forge the scene there.
 *
 * Every write runs in one transaction under the same per-session advisory lock
 * the message routes take (migrateSessionMessages), so a scene write and a
 * message append are serialized, and `rev` checks are race-free.
 */
import { and, eq, or, sql } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  asObject,
  chatSessions,
  db,
  makeId,
  migrateSessionMessages,
  sessionIdEq,
  userEntities,
  type MsgData,
} from "@workspace/db";
import {
  applyScenePatch,
  aspectDisplayName,
  computeAdultGated,
  effectiveScene,
  isAspectKey,
  normalizeStoredScene,
  sceneEventLine,
  sceneHeardBy,
  type SceneChange,
  type ScenePatchError,
  type ScenePatchInput,
  type SceneSession,
  type SceneState,
} from "./sceneState";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The scene as returned to clients, with the computed (never stored) gate. */
export type ScenePayload = SceneState & { adult_gated: boolean };

export type SceneSessionInfo = SceneSession & {
  sessionId: string;
  mode: string;
  /** Server-derived: group with characters from 2+ universes (same rule as the turn). */
  isCrossover: boolean;
  names: Map<string, string>;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

/** Read the stored ChatSession (ownership: user_id scoped) and its characters. */
export async function loadSceneSession(
  userId: string,
  sessionId: string,
  executor: Pick<typeof db, "select"> = db,
): Promise<SceneSessionInfo | null> {
  const [row] = await executor
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, "ChatSession"),
        eq(userEntities.entityId, sessionId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const data = asObject(row.data);
  const groupIds = asStringArray(data.group_character_ids);
  const characterIds = [
    ...new Set([...groupIds, ...(data.character_id ? [String(data.character_id)] : [])]),
  ];
  const mode = String(data.mode || "solo");
  const isGroup = mode === "group" || groupIds.length > 0;
  const names = new Map<string, string>();
  const universes = new Set<string>();
  if (characterIds.length) {
    const rows = await executor
      .select({ entityName: userEntities.entityName, entityId: userEntities.entityId, data: userEntities.data })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          or(eq(userEntities.entityName, "Character"), eq(userEntities.entityName, "Anima")),
          or(...characterIds.map((id) => eq(userEntities.entityId, id))),
        ),
      );
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const d = asObject(r.data);
      // Prefer Character rows, like the chat turn's loadCharacters.
      if (r.entityName === "Anima") {
        if (!byId.has(r.entityId)) byId.set(r.entityId, { ...d, universe: d.universe || "Anima" });
      } else byId.set(r.entityId, d);
    }
    for (const id of characterIds) {
      const d = byId.get(id);
      if (!d) continue;
      if (typeof d.name === "string" && d.name.trim()) names.set(id, d.name.trim());
      if (d.universe) universes.add(String(d.universe));
    }
  }
  return {
    sessionId,
    characterIds,
    isGroup,
    mode,
    isCrossover: mode === "group" && universes.size >= 2,
    names,
  };
}

export function sceneNameOf(info: SceneSessionInfo): (id: string) => string {
  return (id) => (isAspectKey(id) ? aspectDisplayName(id) : info.names.get(id) || "Someone");
}

export function scenePayload(rawScene: unknown, info: SceneSessionInfo): ScenePayload {
  const scene = effectiveScene(normalizeStoredScene(rawScene), info);
  return {
    ...scene,
    adult_gated: computeAdultGated({
      rawScene,
      characterIds: info.characterIds,
      isCrossover: info.isCrossover,
    }),
  };
}

async function readRawScene(executor: Tx | typeof db, userId: string, sessionId: string): Promise<unknown> {
  const [row] = await executor
    .select({ metadata: chatSessions.metadata })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .limit(1);
  return row ? asObject(row.metadata).scene : undefined;
}

/** The stored scene jsonb for a session the caller owns (undefined if none yet). */
export async function readStoredScene(userId: string, sessionId: string): Promise<unknown> {
  return readRawScene(db, userId, sessionId);
}

export type SceneWriteResult =
  | { ok: true; scene: ScenePayload; events: MsgData[] }
  | { ok: false; status: 409; error: "scene_conflict"; scene: ScenePayload }
  | { ok: false; status: 400; error: ScenePatchError };

/**
 * Apply a patch under the session lock. `ifRev` (optional) must equal the
 * stored rev or nothing is written (409 scene_conflict with the current scene).
 * A patch that changes nothing writes nothing and does not bump rev.
 */
export async function writeScenePatch(input: {
  userId: string;
  info: SceneSessionInfo;
  patch: ScenePatchInput;
  ifRev?: number;
  now?: Date;
}): Promise<SceneWriteResult> {
  const { userId, info } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    // Same lock as every message append/replace/delete for this session.
    await migrateSessionMessages(tx, userId, info.sessionId);
    const [existing] = await tx
      .select({ userId: chatSessions.userId, metadata: chatSessions.metadata })
      .from(chatSessions)
      .where(eq(chatSessions.id, info.sessionId))
      .limit(1);
    if (existing && existing.userId !== userId) {
      // A typed row with this id belongs to someone else. Never touch it.
      throw new SceneOwnershipError();
    }
    const metadata = existing ? asObject(existing.metadata) : {};
    const rawScene = metadata.scene;
    const stored = normalizeStoredScene(rawScene);
    if (input.ifRev !== undefined && input.ifRev !== stored.rev) {
      return { ok: false, status: 409, error: "scene_conflict", scene: scenePayload(rawScene, info) };
    }
    const applied = applyScenePatch(stored, input.patch, info, nowIso);
    if (!applied.ok) return { ok: false, status: 400, error: applied.error };
    if (!applied.changed) return { ok: true, scene: scenePayload(rawScene, info), events: [] };
    const nextScene: SceneState = { ...applied.scene, rev: stored.rev + 1 };
    const nextMetadata = { ...metadata, scene: nextScene };
    if (existing) {
      await tx
        .update(chatSessions)
        .set({ metadata: nextMetadata, updatedAt: now })
        .where(and(eq(chatSessions.id, info.sessionId), eq(chatSessions.userId, userId)));
    } else {
      // A chat turn's syncTypedSession may create the row concurrently (it
      // does not take the session lock). Merge only the scene key then, and
      // only into this user's row.
      const inserted = await tx
        .insert(chatSessions)
        .values({
          id: info.sessionId,
          userId,
          mode: info.mode || "solo",
          characterIds: info.characterIds,
          isCrossover: info.isCrossover,
          metadata: nextMetadata,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: chatSessions.id,
          set: {
            metadata: sql`${chatSessions.metadata} || jsonb_build_object('scene', ${JSON.stringify(nextScene)}::jsonb)`,
            updatedAt: now,
          },
          where: eq(chatSessions.userId, userId),
        })
        .returning({ id: chatSessions.id });
      if (inserted.length === 0) throw new SceneOwnershipError();
    }
    const events = await insertSceneEvents(tx, {
      userId,
      sessionId: info.sessionId,
      changes: applied.changes,
      scene: effectiveScene(nextScene, info),
      nameOf: sceneNameOf(info),
      nowIso,
    });
    return { ok: true, scene: scenePayload(nextScene, info), events };
  });
}

export class SceneOwnershipError extends Error {
  constructor() {
    super("Scene session belongs to another user");
    this.name = "SceneOwnershipError";
  }
}

/**
 * One `role:'event'` ChatMessage row per change, appended after the current
 * max seq (the session lock is already held). Returns the full persisted rows.
 */
export async function insertSceneEvents(
  tx: Tx,
  input: {
    userId: string;
    sessionId: string;
    changes: SceneChange[];
    scene: SceneState;
    nameOf: (id: string) => string;
    nowIso: string;
  },
): Promise<MsgData[]> {
  if (input.changes.length === 0) return [];
  const [agg] = await tx
    .select({
      maxSeq: sql<string>`coalesce(max((${userEntities.data} ->> 'seq')::numeric), -1)`,
    })
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, input.userId),
        eq(userEntities.entityName, CHAT_MESSAGE),
        sessionIdEq(input.sessionId),
      ),
    );
  let seq = Number(agg?.maxSeq ?? -1) + 1;
  const hearing = sceneHeardBy(input.scene);
  const rows: MsgData[] = [];
  for (const change of input.changes) {
    const id = makeId();
    const subject = "characterId" in change ? change.characterId : null;
    const heardBy = [...hearing];
    // The character who leaves or changes state knows it happened.
    if (subject && !isAspectKey(subject) && !heardBy.includes(subject)) heardBy.push(subject);
    const metadata: Record<string, unknown> = {
      kind: change.kind,
      heard_by: heardBy,
      scene_rev: input.scene.rev,
    };
    if (subject) {
      metadata.character_id = subject;
      metadata.presence = (change as { presence: string }).presence;
    } else {
      metadata.location = (change as { location: string | null }).location;
    }
    const data: MsgData = {
      id,
      role: "event",
      content: sceneEventLine(change, input.nameOf),
      metadata,
      session_id: input.sessionId,
      seq,
      created_at: input.nowIso,
      created_date: input.nowIso,
      updated_date: input.nowIso,
    };
    await tx.insert(userEntities).values({
      userId: input.userId,
      entityName: CHAT_MESSAGE,
      entityId: id,
      data,
    });
    rows.push(data);
    seq += 1;
  }
  return rows;
}
