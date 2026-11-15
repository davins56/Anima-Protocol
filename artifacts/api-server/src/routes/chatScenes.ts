/**
 * Situational scenes (#763) PR 1: scene state endpoints, mounted on the chat
 * router (so /api/chat/sessions/:sessionId/scene...).
 *
 *   GET   /sessions/:sessionId/scene          -> scene (+ adult_gated)
 *   PATCH /sessions/:sessionId/scene          {location?, narrator?, mode?, cast?, if_rev?} -> {scene, events}
 *   POST  /sessions/:sessionId/scene/command  {text:"/scene <place>, <names…>", if_rev?} -> {scene, events, unresolved}
 *
 * All three: requireUser, then the session must belong to the caller (404).
 * With ANIMA_SITUATIONAL_SCENES off they answer 409 {error:"scenes_disabled"}
 * and touch nothing.
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import {
  ASPECT_PREFIX,
  SCENE_ASPECTS,
  parseSceneCommand,
  sceneCommandPatch,
  scenesEnabled,
} from "../lib/scenes/sceneState";
import {
  SceneOwnershipError,
  loadSceneSession,
  readStoredScene,
  sceneNameOf,
  scenePayload,
  writeScenePatch,
  type SceneSessionInfo,
} from "../lib/scenes/sceneStore";

const router = Router();

async function sceneGuard(req: Request, res: Response): Promise<{ userId: string; info: SceneSessionInfo } | null> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!scenesEnabled()) {
    res.status(409).json({ error: "scenes_disabled" });
    return null;
  }
  const sessionId = String(req.params.sessionId || "").trim();
  const info = sessionId ? await loadSceneSession(userId, sessionId) : null;
  if (!info) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  return { userId, info };
}

function parseIfRev(value: unknown): { ok: true; ifRev?: number } | { ok: false } {
  if (value === undefined || value === null) return { ok: true };
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  return { ok: true, ifRev: n };
}

async function respondWrite(
  res: Response,
  run: () => ReturnType<typeof writeScenePatch>,
  extra: Record<string, unknown> = {},
) {
  try {
    const result = await run();
    if (result.ok) {
      res.json({ scene: result.scene, events: result.events, ...extra });
      return;
    }
    if (result.status === 409) {
      res.status(409).json({ error: result.error, scene: result.scene });
      return;
    }
    res.status(400).json({ ...result.error, status: undefined });
  } catch (err) {
    if (err instanceof SceneOwnershipError) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    throw err;
  }
}

router.get("/sessions/:sessionId/scene", async (req, res) => {
  const guard = await sceneGuard(req, res);
  if (!guard) return;
  const raw = await readStoredScene(guard.userId, guard.info.sessionId);
  res.json(scenePayload(raw, guard.info));
});

router.patch("/sessions/:sessionId/scene", async (req, res) => {
  const guard = await sceneGuard(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ifRev = parseIfRev(body.if_rev);
  if (!ifRev.ok) {
    res.status(400).json({ error: "invalid_scene_patch", detail: "if_rev must be a non-negative integer" });
    return;
  }
  await respondWrite(res, () =>
    writeScenePatch({
      userId: guard.userId,
      info: guard.info,
      patch: { location: body.location, narrator: body.narrator, mode: body.mode, cast: body.cast },
      ifRev: ifRev.ifRev,
    }),
  );
});

router.post("/sessions/:sessionId/scene/command", async (req, res) => {
  const guard = await sceneGuard(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ifRev = parseIfRev(body.if_rev);
  if (!ifRev.ok) {
    res.status(400).json({ error: "invalid_scene_command", detail: "if_rev must be a non-negative integer" });
    return;
  }
  const parsed = parseSceneCommand(body.text);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_scene_command", detail: parsed.error });
    return;
  }
  const nameOf = sceneNameOf(guard.info);
  const raw = await readStoredScene(guard.userId, guard.info.sessionId);
  const castIds = Object.keys(scenePayload(raw, guard.info).cast);
  const members: Array<{ id: string; name: string; optional?: boolean }> = castIds.map((id) => ({ id, name: nameOf(id) }));
  if (!guard.info.isGroup) {
    // Solo Lover Matrix (M7): any aspect can be named into the scene.
    for (const slug of SCENE_ASPECTS) {
      const id = `${ASPECT_PREFIX}${slug}`;
      if (!castIds.includes(id)) members.push({ id, name: nameOf(id), optional: true });
    }
  }
  const { patch, unresolved } = sceneCommandPatch({ parsed, members });
  if (unresolved.length) {
    logger.info({ sessionId: guard.info.sessionId, unresolved: unresolved.length }, "Scene command had unknown names");
  }
  await respondWrite(
    res,
    () => writeScenePatch({ userId: guard.userId, info: guard.info, patch, ifRev: ifRev.ifRev }),
    { unresolved },
  );
});

export default router;
