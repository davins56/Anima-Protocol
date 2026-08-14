import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
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

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isHomeObject(value: unknown): value is NonNullable<HomeRoom["objects"]>[number] {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "name", "description", "placedBy"])) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    optionalString(value.description) &&
    optionalString(value.placedBy)
  );
}

function isHomeRoom(value: unknown): value is HomeRoom {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "name", "description", "objects"])) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    (value.objects === undefined || (Array.isArray(value.objects) && value.objects.every(isHomeObject)))
  );
}

function isHomeRitual(value: unknown): value is HomeRitual {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "name", "description", "lastPerformedAt"])) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    optionalString(value.description) &&
    optionalString(value.lastPerformedAt)
  );
}

function isHomeArtifact(value: unknown): value is HomeArtifact {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "name", "memory", "createdAt"])) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    optionalString(value.memory) &&
    optionalString(value.createdAt)
  );
}

function parseHomePatch(value: unknown): Partial<HomeState> | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ["rooms", "atmosphere", "lastVisitedRoomId", "rituals", "sharedArtifacts", "narrativeNotes"])) {
    return null;
  }
  if (value.rooms !== undefined && (!Array.isArray(value.rooms) || !value.rooms.every(isHomeRoom))) return null;
  if (value.rituals !== undefined && (!Array.isArray(value.rituals) || !value.rituals.every(isHomeRitual))) return null;
  if (value.sharedArtifacts !== undefined && (!Array.isArray(value.sharedArtifacts) || !value.sharedArtifacts.every(isHomeArtifact))) return null;
  if (!optionalString(value.atmosphere) || !optionalString(value.lastVisitedRoomId) || !optionalString(value.narrativeNotes)) return null;
  return value as Partial<HomeState>;
}

function parseResonanceVector(value: unknown): ResonanceVector | null {
  if (!isRecord(value)) return null;
  const ranges: Record<keyof ResonanceVector, readonly [number, number]> = {
    intimacy: [0, 100],
    powerDynamic: [-50, 50],
    spiritualAttunement: [0, 100],
    primalIntensity: [0, 100],
    crossoverOpenness: [0, 100],
  };
  if (!hasOnlyKeys(value, Object.keys(ranges))) return null;
  for (const [key, [min, max]] of Object.entries(ranges) as Array<[keyof ResonanceVector, readonly [number, number]]>) {
    const dimension = value[key];
    if (typeof dimension !== "number" || !Number.isFinite(dimension) || dimension < min || dimension > max) return null;
  }
  return value as unknown as ResonanceVector;
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
  const resonanceSnapshot = parseResonanceVector(body.resonanceSnapshot);
  if (!body.title || !body.body || !resonanceSnapshot) {
    res.status(400).json({ error: "title, body, and valid resonanceSnapshot required" });
    return;
  }
  const memory = await crystallizeResonanceMemory({
    userId,
    animaId,
    sessionId: body.sessionId,
    title: String(body.title),
    body: String(body.body),
    resonanceSnapshot,
    emotionalTone: body.emotionalTone,
    tags: body.tags,
    intensity: body.intensity,
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
  const patch = parseHomePatch(req.body ?? {});
  if (!patch) {
    res.status(400).json({ error: "Invalid Home World patch" });
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

export default router;
