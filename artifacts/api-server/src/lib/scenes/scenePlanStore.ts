/**
 * Situational scenes (#763) PR 3: plan + stage-marker persistence. Every
 * read-check-write runs in one transaction under the per-session advisory
 * lock (migrateSessionMessages), the same lock as PATCH and every message
 * append, so a plan check and a scene write can't interleave.
 */
import { and, eq, sql } from "drizzle-orm";
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
import { applyScenePatch, effectiveScene, normalizeStoredScene, sceneHeardBy, type SceneState } from "./sceneState";
import {
  SceneOwnershipError,
  insertSceneEvents,
  loadSceneSession,
  sceneNameOf,
  scenePayload,
  type ScenePayload,
  type SceneSessionInfo,
} from "./sceneStore";
import { mentionedCastIds } from "./awareness";
import {
  PLAN_TTL_MS,
  markerCastPatch,
  planSpeakers,
  readPlan,
  remainingSpeakers,
  revalidateQueue,
  type BlockedSpeaker,
  type PlanSpeaker,
  type ScenePlan,
  type StageMarker,
} from "./scenePlan";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ScenePlanFrame = {
  id: string | null;
  speakers: PlanSpeaker[];
  blocked: BlockedSpeaker[];
  narrate: boolean;
  mode: "natural" | "everyone";
};

export type SceneTurnStart =
  | { ok: false; status: 409; error: "scene_plan_stale"; scene: ScenePayload }
  | {
      ok: true;
      info: SceneSessionInfo;
      /** The speaker the plan picked for this request (null = nobody). */
      speakerId: string | null;
      /** Group turns only: the frame sent before any content. */
      frame: ScenePlanFrame | null;
      planId: string | null;
      responderIndex: number | null;
      blocked: BlockedSpeaker[];
      scene: ScenePayload;
      /** The effective scene at turn start (used for stamps and the narrator). */
      state: SceneState;
    };

async function lockedSession(tx: Tx, userId: string, sessionId: string) {
  await migrateSessionMessages(tx, userId, sessionId);
  const [row] = await tx
    .select({ userId: chatSessions.userId, metadata: chatSessions.metadata })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);
  if (row && row.userId !== userId) throw new SceneOwnershipError();
  return { exists: Boolean(row), metadata: row ? asObject(row.metadata) : {} };
}

/** Merge `scene` into chat_sessions.metadata for this user's row (create it if missing). */
async function writeRawScene(
  tx: Tx,
  userId: string,
  info: SceneSessionInfo,
  exists: boolean,
  rawScene: Record<string, unknown>,
  now: Date,
) {
  const merge = sql`${chatSessions.metadata} || jsonb_build_object('scene', ${JSON.stringify(rawScene)}::jsonb)`;
  if (exists) {
    await tx
      .update(chatSessions)
      .set({ metadata: merge, updatedAt: now })
      .where(and(eq(chatSessions.id, info.sessionId), eq(chatSessions.userId, userId)));
    return;
  }
  const inserted = await tx
    .insert(chatSessions)
    .values({
      id: info.sessionId,
      userId,
      mode: info.mode || "solo",
      characterIds: info.characterIds,
      isCrossover: info.isCrossover,
      metadata: { scene: rawScene },
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: chatSessions.id, set: { metadata: merge, updatedAt: now }, where: eq(chatSessions.userId, userId) })
    .returning({ id: chatSessions.id });
  if (inserted.length === 0) throw new SceneOwnershipError();
}

function stale(rawScene: unknown, info: SceneSessionInfo): SceneTurnStart {
  return { ok: false, status: 409, error: "scene_plan_stale", scene: scenePayload(rawScene, info) };
}

/**
 * Validate (R2) and plan the speaker for one POST /messages.
 * - `if_rev` (when sent) must equal the stored rev;
 * - a plan-following request needs the stored plan's id and index, an
 *   unexpired plan, and a plan rev equal to the scene rev (the plan's own
 *   markers move both; anything else makes it stale);
 * - otherwise a new plan is made from the stored cast and scene.
 * Null when the session is not the caller's or has no characters.
 */
export async function beginSceneTurn(input: {
  userId: string;
  sessionId: string;
  ifRev: number | null;
  planId: string | null;
  responderIndex: number | null;
  requested: string | null;
  content: string;
  isContinue: boolean;
  /** The request's turn id: a repeat of the same turn reuses its plan. */
  turnId?: string | null;
  now?: Date;
}): Promise<SceneTurnStart | null> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const { exists, metadata } = await lockedSession(tx, input.userId, input.sessionId);
    const info = await loadSceneSession(input.userId, input.sessionId, tx);
    if (!info || !info.characterIds.length) return null;
    const rawScene = metadata.scene;
    const stored = normalizeStoredScene(rawScene);
    const scene = effectiveScene(stored, info);
    if (input.ifRev !== null && input.ifRev !== stored.rev) return stale(rawScene, info);
    const base = { ok: true as const, info, state: scene, scene: scenePayload(rawScene, info) };
    if (!info.isGroup) {
      return { ...base, speakerId: null, frame: null, planId: null, responderIndex: null, blocked: [] };
    }
    const rawObj = asObject(rawScene);
    if (input.planId !== null) {
      const plan = readPlan(rawObj.plan);
      if (
        !plan ||
        plan.id !== input.planId ||
        input.responderIndex === null ||
        plan.index !== input.responderIndex ||
        Date.parse(plan.expires_at) <= now.getTime() ||
        plan.rev !== stored.rev
      ) {
        return stale(rawScene, info);
      }
      const next = revalidateQueue(plan, scene, plan.index);
      const speakers = next.index === null ? [] : remainingSpeakers(plan, scene, next.index);
      const updated = { ...asObject(rawObj.plan), ...plan, index: next.index ?? plan.queue.length };
      await writeRawScene(tx, input.userId, info, exists, { ...rawObj, plan: updated }, now);
      return {
        ...base,
        speakerId: next.index === null ? null : plan.queue[next.index]!,
        frame: { id: plan.id, speakers, blocked: next.blocked, narrate: false, mode: plan.mode },
        planId: plan.id,
        responderIndex: next.index,
        blocked: next.blocked,
      };
    }
    const existing = readPlan(rawObj.plan);
    // A repeat (or replay) of the turn that made the current plan never
    // replaces it: the ledger replays or joins that turn, and the plan keeps
    // whatever progress it has made.
    if (existing && input.turnId && asObject(rawObj.plan).turn_id === input.turnId) {
      return {
        ...base,
        speakerId: existing.queue[0]!,
        frame: { id: existing.id, speakers: remainingSpeakers(existing, scene, 0), blocked: [], narrate: false, mode: existing.mode },
        planId: existing.id,
        responderIndex: 0,
        blocked: [],
      };
    }
    const mentioned = input.isContinue ? [] : mentionedCastIds(input.content, info.names);
    const planned = planSpeakers({
      scene,
      cast: info.characterIds,
      requested: input.requested,
      mentioned,
      isContinue: input.isContinue,
    });
    const mode = scene.mode === "everyone" ? "everyone" : "natural";
    let planId: string | null = null;
    if (planned.speakers.length) {
      const plan: ScenePlan = {
        id: `plan_${makeId()}`,
        rev: stored.rev,
        queue: planned.speakers.map((s) => s.character_id),
        reasons: planned.speakers.map((s) => s.reason),
        addressed: mentioned,
        index: 0,
        expires_at: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
        mode,
      };
      planId = plan.id;
      await writeRawScene(tx, input.userId, info, exists, { ...rawObj, plan: { ...plan, turn_id: input.turnId ?? null } }, now);
    } else if (rawObj.plan !== undefined) {
      const { plan: _old, ...rest } = rawObj;
      void _old;
      await writeRawScene(tx, input.userId, info, exists, rest, now);
    }
    return {
      ...base,
      speakerId: planned.speakers[0]?.character_id ?? null,
      frame: { id: planId ?? `plan_${makeId()}`, speakers: planned.speakers, blocked: planned.blocked, narrate: planned.narrate, mode },
      planId,
      responderIndex: planId ? 0 : null,
      blocked: planned.blocked,
    };
  });
}

export type SceneTurnFinish = {
  scene: ScenePayload;
  events: MsgData[];
  next_speaker: { character_id: string; responder_index: number } | null;
  blocked: BlockedSpeaker[];
};

/**
 * After the reply: apply the speaker's permitted stage markers (rev bump +
 * event rows), then advance the plan past this speaker, revalidating the
 * rest of the queue against the scene as it is now. The plan's rev follows
 * its own marker bumps, so they never make it stale.
 */
export async function finishSceneTurn(input: {
  userId: string;
  sessionId: string;
  speakerId: string | null;
  planId: string | null;
  responderIndex: number | null;
  markers: readonly StageMarker[];
  blocked: readonly BlockedSpeaker[];
  /** The chat turn whose reply carried the markers (stamped on its event rows). */
  turnId?: string | null;
  now?: Date;
}): Promise<SceneTurnFinish | null> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    const { exists, metadata } = await lockedSession(tx, input.userId, input.sessionId);
    const info = await loadSceneSession(input.userId, input.sessionId, tx);
    if (!info) return null;
    const rawObj = asObject(metadata.scene);
    const stored = normalizeStoredScene(metadata.scene);
    const plan = readPlan(rawObj.plan);
    const ownsPlan =
      plan !== null &&
      input.planId !== null &&
      plan.id === input.planId &&
      plan.index === input.responderIndex &&
      plan.rev === stored.rev;
    // Markers count only from the speaker this request was planned for (or
    // the requested speaker of a solo / unplanned turn), and only while the
    // scene has not been moved by someone else.
    const authorized = input.planId === null || ownsPlan;
    let nextStored: SceneState = stored;
    let events: MsgData[] = [];
    const castPatch = authorized
      ? markerCastPatch({ markers: input.markers, scene: effectiveScene(stored, info), speakerId: input.speakerId, names: info.names })
      : null;
    if (castPatch) {
      const applied = applyScenePatch(stored, { cast: castPatch }, info, nowIso);
      if (applied.ok && applied.changed) {
        nextStored = { ...applied.scene, rev: stored.rev + 1 };
        events = await insertSceneEvents(tx, {
          userId: input.userId,
          sessionId: info.sessionId,
          changes: applied.changes,
          scene: effectiveScene(nextStored, info),
          nameOf: sceneNameOf(info),
          nowIso,
          turnId: input.turnId ?? null,
        });
      }
    }
    const blocked = [...input.blocked];
    let nextSpeaker: SceneTurnFinish["next_speaker"] = null;
    let nextPlan: ScenePlan | null | undefined;
    if (ownsPlan && plan) {
      const after = revalidateQueue(plan, effectiveScene(nextStored, info), plan.index + 1);
      for (const b of after.blocked) if (!blocked.some((x) => x.id === b.id)) blocked.push(b);
      nextPlan = { ...asObject(rawObj.plan), ...plan, rev: nextStored.rev, index: after.index ?? plan.queue.length } as ScenePlan;
      if (after.index !== null) nextSpeaker = { character_id: plan.queue[after.index]!, responder_index: after.index };
    }
    const changed = nextStored !== stored || nextPlan !== undefined;
    let raw: Record<string, unknown> = metadata.scene === undefined && !changed ? {} : { ...rawObj };
    if (nextStored !== stored) raw = { ...raw, ...nextStored };
    if (nextPlan !== undefined) raw.plan = nextPlan;
    if (changed) await writeRawScene(tx, input.userId, info, exists, raw, now);
    return {
      scene: scenePayload(changed ? raw : metadata.scene, info),
      events,
      next_speaker: nextSpeaker,
      blocked,
    };
  });
}

/**
 * M3: one narration row for a zero-speaker turn (narrator on). Heard by
 * whoever is here. The text is generated by the caller.
 */
export async function insertNarrationRow(input: {
  userId: string;
  sessionId: string;
  content: string;
  now?: Date;
}): Promise<MsgData | null> {
  const nowIso = (input.now ?? new Date()).toISOString();
  return db.transaction(async (tx) => {
    const { metadata } = await lockedSession(tx, input.userId, input.sessionId);
    const info = await loadSceneSession(input.userId, input.sessionId, tx);
    if (!info) return null;
    const stored = normalizeStoredScene(metadata.scene);
    const scene = effectiveScene(stored, info);
    const [agg] = await tx
      .select({ maxSeq: sql<string>`coalesce(max((${userEntities.data} ->> 'seq')::numeric), -1)` })
      .from(userEntities)
      .where(and(eq(userEntities.userId, input.userId), eq(userEntities.entityName, CHAT_MESSAGE), sessionIdEq(input.sessionId)));
    const id = makeId();
    const data: MsgData = {
      id,
      role: "event",
      content: input.content,
      metadata: { kind: "narration", heard_by: sceneHeardBy(scene), scene_rev: stored.rev },
      session_id: input.sessionId,
      seq: Number(agg?.maxSeq ?? -1) + 1,
      created_at: nowIso,
      created_date: nowIso,
      updated_date: nowIso,
    };
    await tx.insert(userEntities).values({ userId: input.userId, entityName: CHAT_MESSAGE, entityId: id, data });
    return data;
  });
}
