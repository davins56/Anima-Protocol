import { Router, type Request, type Response } from "express";
import { loadTimelineEvents, openRelationshipChapter } from "../lib/relationshipTimeline";
import {
  crystallizeResonanceMemory,
  loadResonanceMemories,
} from "../lib/resonanceMemories";
import {
  loadJournalEntries,
  markJournalRead,
  writeJournalEntry,
} from "../lib/animaJournal";
import {
  ensureHomeWorld,
  loadHomeWorld,
  placeObjectInHome,
  registerHomeRitual,
  addSharedArtifact,
  updateHomeWorldState,
} from "../lib/homeWorld";

const router = Router();

function requireUser(req: Request, res: Response): string | null {
  const userId =
    (req as any).auth?.userId ||
    (req as any).userId ||
    (req.headers["x-user-id"] as string | undefined);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return String(userId);
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
  if (!body.title || !body.body || !body.resonanceSnapshot) {
    res.status(400).json({ error: "title, body, resonanceSnapshot required" });
    return;
  }
  const memory = await crystallizeResonanceMemory({
    userId,
    animaId,
    sessionId: body.sessionId,
    title: String(body.title),
    body: String(body.body),
    resonanceSnapshot: body.resonanceSnapshot,
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
  const home = await updateHomeWorldState(userId, req.body ?? {});
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
