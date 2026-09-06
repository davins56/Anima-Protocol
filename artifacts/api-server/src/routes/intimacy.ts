import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  defaultProfile,
  loadIntimacyProfile,
  saveIntimacyProfile,
  loadIntimacyScene,
  listRecentScenes,
} from "../lib/intimacyStore";
import { decayHeat } from "../lib/intimacyEngine";
import type { IntimacyProfile } from "../lib/intimacyTypes";

const router = Router();

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function patchProfile(base: IntimacyProfile, body: Record<string, unknown>): IntimacyProfile {
  const next = { ...base };
  if (typeof body.intimacyEnabled === "boolean") next.intimacyEnabled = body.intimacyEnabled;
  if (typeof body.preferredPace === "string") next.preferredPace = body.preferredPace as IntimacyProfile["preferredPace"];
  if (typeof body.safeword === "string" && body.safeword.trim()) next.safeword = body.safeword.trim().slice(0, 40);
  if (typeof body.aftercareStyle === "string") next.aftercareStyle = body.aftercareStyle.slice(0, 240);
  if (typeof body.powerAxis === "number") next.powerAxis = Math.max(-1, Math.min(1, body.powerAxis));
  if (Array.isArray(body.kinks)) next.kinks = body.kinks.map(String).slice(0, 24);
  if (Array.isArray(body.limits)) next.limits = body.limits.map(String).slice(0, 24);
  if (Array.isArray(body.softLimits)) next.softLimits = body.softLimits.map(String).slice(0, 24);
  if (body.anatomy && typeof body.anatomy === "object") {
    next.anatomy = { ...next.anatomy, ...(body.anatomy as IntimacyProfile["anatomy"]) };
  }
  return next;
}

router.get("/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const characterId = String(req.params.characterId || "").trim();
  if (!characterId) {
    res.status(400).json({ error: "characterId is required" });
    return;
  }
  let profile = await loadIntimacyProfile(userId, characterId);
  if (profile.lastSceneAt) {
    const idle = (Date.now() - Date.parse(profile.lastSceneAt)) / 60000;
    if (idle >= 8) {
      profile = decayHeat(profile, idle);
      await saveIntimacyProfile(profile);
    }
  }
  const scenes = await listRecentScenes(userId, characterId, 6);
  res.json({ profile, scenes });
});

router.patch("/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const characterId = String(req.params.characterId || "").trim();
  if (!characterId) {
    res.status(400).json({ error: "characterId is required" });
    return;
  }
  const current = await loadIntimacyProfile(userId, characterId);
  const next = patchProfile(current.characterId ? current : defaultProfile(userId, characterId), req.body || {});
  await saveIntimacyProfile(next);
  res.json({ profile: next });
});

router.get("/:characterId/scene/:conversationId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const scene = await loadIntimacyScene(
    userId,
    String(req.params.conversationId),
    String(req.params.characterId),
  );
  res.json({ scene });
});

export default router;
