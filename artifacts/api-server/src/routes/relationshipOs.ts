import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, or } from "drizzle-orm";
import { db, userEntities, withTransientDbRetry } from "@workspace/db";
import {
  SACRED_ACTIVITIES,
  awardSacredSpaceResonance,
  isValidSacredSessionId,
  readSynchroSummary,
  type SacredActivity,
} from "../lib/sacredSpaceResonance";
import { SYNCHRO_THRESHOLDS } from "../lib/synchroEngine";
import { loadTimelineEvents, openRelationshipChapter } from "../lib/relationshipTimeline";
import {
  crystallizeResonanceMemory,
  loadResonanceMemories,
} from "../lib/resonanceMemories";
import type { ResonanceVector } from "../lib/resonanceState";
import {
  loadJournalEntries,
  markJournalRead,
  writeJournalEntry,
} from "../lib/animaJournal";
import {
  ensureHomeWorld,
  placeObjectInHome,
  registerHomeRitual,
  addSharedArtifact,
  updateHomeWorldState,
  type HomeArtifact,
  type HomeRoom,
  type HomeRitual,
  type HomeState,
} from "../lib/homeWorld";

const router = Router();

/**
 * Auth is Clerk-only. Never accept client-controlled identity headers
 * (x-user-id) or untyped req.userId — that would allow cross-user reads/writes.
 */
function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

const RESONANCE_DIMS = [
  "intimacy",
  "powerDynamic",
  "spiritualAttunement",
  "primalIntensity",
  "crossoverOpenness",
] as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Enforce the ResonanceVector contract before persistence. */
function parseResonanceSnapshot(raw: unknown): ResonanceVector | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: Partial<ResonanceVector> = {};
  for (const key of RESONANCE_DIMS) {
    if (!isFiniteNumber(obj[key])) return null;
    out[key] = obj[key];
  }
  // Documented ranges from resonanceState.ts
  if (out.intimacy! < 0 || out.intimacy! > 100) return null;
  if (out.powerDynamic! < -50 || out.powerDynamic! > 50) return null;
  if (out.spiritualAttunement! < 0 || out.spiritualAttunement! > 100) return null;
  if (out.primalIntensity! < 0 || out.primalIntensity! > 100) return null;
  if (out.crossoverOpenness! < 0 || out.crossoverOpenness! > 100) return null;
  return out as ResonanceVector;
}

/** Accept only known HomeState keys; reject malformed nested arrays. */
function parseHomeStatePatch(raw: unknown): Partial<HomeState> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const patch: Partial<HomeState> = {};

  if ("atmosphere" in body) {
    if (typeof body.atmosphere !== "string") return null;
    patch.atmosphere = body.atmosphere;
  }
  if ("lastVisitedRoomId" in body) {
    if (typeof body.lastVisitedRoomId !== "string") return null;
    patch.lastVisitedRoomId = body.lastVisitedRoomId;
  }
  if ("narrativeNotes" in body) {
    if (typeof body.narrativeNotes !== "string") return null;
    patch.narrativeNotes = body.narrativeNotes;
  }
  if ("rooms" in body) {
    if (!Array.isArray(body.rooms)) return null;
    for (const room of body.rooms) {
      if (!room || typeof room !== "object") return null;
      const r = room as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.name !== "string") return null;
      if (r.description != null && typeof r.description !== "string") return null;
      if (r.objects != null && !Array.isArray(r.objects)) return null;
    }
    patch.rooms = body.rooms as HomeState["rooms"];
  }
  if ("rituals" in body) {
    if (!Array.isArray(body.rituals)) return null;
    for (const ritual of body.rituals) {
      if (!ritual || typeof ritual !== "object") return null;
      const r = ritual as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.name !== "string") return null;
    }
    patch.rituals = body.rituals as HomeState["rituals"];
  }
  if ("sharedArtifacts" in body) {
    if (!Array.isArray(body.sharedArtifacts)) return null;
    for (const art of body.sharedArtifacts) {
      if (!art || typeof art !== "object") return null;
      const a = art as Record<string, unknown>;
      if (typeof a.id !== "string" || typeof a.name !== "string") return null;
    }
    patch.sharedArtifacts = body.sharedArtifacts as HomeState["sharedArtifacts"];
  }

  // Reject unknown top-level keys so clients cannot inject arbitrary JSONB.
  const allowed = new Set([
    "atmosphere",
    "lastVisitedRoomId",
    "narrativeNotes",
    "rooms",
    "rituals",
    "sharedArtifacts",
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return null;
  }

  return patch;
}

// ---------- Timeline ----------

router.get("/timeline/:animaId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const animaId = String(req.params.animaId);
  const limit = Number(req.query.limit) || 40;
  const eventType = req.query.eventType as any;
  const events = await loadTimelineEvents({ userId, animaId, limit, eventType });
  res.json({ events });
});

router.post("/timeline/:animaId/chapter", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const animaId = String(req.params.animaId);
  const { title, summary, chapterIndex } = req.body ?? {};
  if (!title) {
    res.status(400).json({ error: "title required" });
    return;
  }
  const event = await openRelationshipChapter({
    userId,
    animaId,
    title: String(title),
    summary: summary ? String(summary) : undefined,
    chapterIndex: chapterIndex != null ? Number(chapterIndex) : undefined,
  });
  res.json({ event });
});

// ---------- Resonance Memories ----------

router.get("/resonance-memories/:animaId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const animaId = String(req.params.animaId);
  const limit = Number(req.query.limit) || 12;
  const memories = await loadResonanceMemories({ userId, animaId, limit });
  res.json({ memories });
});

router.post("/resonance-memories/:animaId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const animaId = String(req.params.animaId);
  const body = req.body ?? {};
  if (!body.title || !body.body || body.resonanceSnapshot == null) {
    res.status(400).json({ error: "title, body, resonanceSnapshot required" });
    return;
  }
  const resonanceSnapshot = parseResonanceSnapshot(body.resonanceSnapshot);
  if (!resonanceSnapshot) {
    res.status(400).json({
      error:
        "resonanceSnapshot must be a ResonanceVector with five finite dimensions " +
        "(intimacy 0-100, powerDynamic -50..50, spiritualAttunement 0-100, " +
        "primalIntensity 0-100, crossoverOpenness 0-100)",
    });
    return;
  }
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t: unknown) => typeof t === "string").map(String)
    : undefined;
  const intensity =
    body.intensity != null && isFiniteNumber(body.intensity)
      ? body.intensity
      : undefined;
  const memory = await crystallizeResonanceMemory({
    userId,
    animaId,
    sessionId: body.sessionId != null ? String(body.sessionId) : undefined,
    title: String(body.title),
    body: String(body.body),
    resonanceSnapshot,
    emotionalTone:
      body.emotionalTone != null ? String(body.emotionalTone) : undefined,
    tags,
    intensity,
  });
  res.json({ memory });
});

// ---------- Journal ----------

router.get("/journal/:animaId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const animaId = String(req.params.animaId);
  const limit = Number(req.query.limit) || 20;
  const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
  const entries = await loadJournalEntries({ userId, animaId, limit, unreadOnly });
  res.json({ entries });
});

router.post("/journal/:animaId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const animaId = String(req.params.animaId);
  const body = req.body ?? {};
  if (!body.title || !body.content) {
    res.status(400).json({ error: "title and content required" });
    return;
  }
  const entry = await writeJournalEntry({
    userId,
    animaId,
    entryType: body.entryType,
    title: String(body.title),
    content: String(body.content),
    sourceSessionId: body.sourceSessionId,
    metadata: body.metadata,
  });
  res.json({ entry });
});

router.post("/journal/:animaId/:entryId/read", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  await markJournalRead(String(req.params.entryId), userId);
  res.json({ ok: true });
});

// ---------- Home ----------

router.get("/home", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const home = await ensureHomeWorld(userId);
  res.json({ home });
});

router.patch("/home", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const patch = parseHomeStatePatch(req.body ?? {});
  if (!patch) {
    res.status(400).json({
      error:
        "Invalid HomeState patch. Allowed keys: atmosphere, lastVisitedRoomId, " +
        "narrativeNotes, rooms, rituals, sharedArtifacts. Nested structures must match HomeState.",
    });
    return;
  }
  const home = await updateHomeWorldState(userId, patch);
  res.json({ home });
});

router.post("/home/objects", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { roomId, name, description, placedBy } = req.body ?? {};
  if (!roomId || !name) {
    res.status(400).json({ error: "roomId and name required" });
    return;
  }
  const home = await placeObjectInHome({
    userId,
    roomId: String(roomId),
    object: { name: String(name), description, placedBy },
  });
  res.json({ home });
});

router.post("/home/rituals", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { name, description } = req.body ?? {};
  if (!name) {
    res.status(400).json({ error: "name required" });
    return;
  }
  const home = await registerHomeRitual({
    userId,
    name: String(name),
    description,
  });
  res.json({ home });
});

router.post("/home/artifacts", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { name, memory } = req.body ?? {};
  if (!name) {
    res.status(400).json({ error: "name required" });
    return;
  }
  const home = await addSharedArtifact({
    userId,
    name: String(name),
    memory,
  });
  res.json({ home });
});

async function userOwnsCharacter(userId: string, characterId: string): Promise<boolean> {
  const rows = await withTransientDbRetry(() =>
    db
      .select({ id: userEntities.id })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          or(eq(userEntities.entityName, "Character"), eq(userEntities.entityName, "Anima")),
          eq(userEntities.entityId, characterId),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

function boundedCount(value: unknown, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
}

/** Long-term resonance (Synchro) for one of the caller's companions. Separate from Heat. */
router.get("/synchro/:characterId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const characterId = String(req.params.characterId || "").trim();
  if (!characterId) {
    res.status(400).json({ error: "characterId required" });
    return;
  }
  const summary = await readSynchroSummary(userId, characterId);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ synchro: { ...summary, thresholds: SYNCHRO_THRESHOLDS } });
});

/**
 * A completed Sacred Space activity earns bounded resonance. The server owns
 * the amount; the body only identifies the activity and the session, so a
 * client cannot choose how much it earns. Replaying a session id is a no-op.
 */
router.post("/sacred-space/complete", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const characterId = typeof body.character_id === "string" ? body.character_id.trim() : "";
  const activity = body.activity as SacredActivity;
  if (!characterId) {
    res.status(400).json({ error: "character_id required" });
    return;
  }
  if (!SACRED_ACTIVITIES.includes(activity)) {
    res.status(400).json({ error: "activity must be sacred_space_session or meditation_ritual" });
    return;
  }
  if (!isValidSacredSessionId(body.session_id)) {
    res.status(400).json({ error: "session_id required (8-100 chars: letters, digits, _ . : -)" });
    return;
  }
  if (!(await userOwnsCharacter(userId, characterId))) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const result = await awardSacredSpaceResonance({
    userId,
    characterId,
    sessionId: body.session_id,
    completion: {
      activity,
      userTurns: boundedCount(body.user_turns, 200),
      stepsCompleted: boundedCount(body.steps_completed, 6),
      hasReflection: body.has_reflection === true,
    },
  });
  res.json({ resonance: result });
});

export default router;
