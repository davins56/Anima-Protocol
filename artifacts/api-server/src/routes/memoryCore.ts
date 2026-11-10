/**
 * Persistent memory core API (append-only).
 *
 *   GET  /api/memory-core/:characterId/health
 *   GET  /api/memory-core/:characterId/recalls     ?limit=&cursor=&session_id=  (read-only recall ledger, docs/recall-ledger.md)
 *   POST /api/memory-core/:characterId/bootstrap   { sessionId?, query?, limit? }
 *   POST /api/memory-core/:characterId/events      { event_type, content, payload?, emotional_weight?, conversation_id?, message_id? }
 *   POST /api/memory-core/:characterId/identity    { name, personality_matrix?, voice?, core_traits?, relationships?, backstory?, change_note? }
 *   POST /api/memory-core/:characterId/retract     { event_id, reason? }   (appends a retraction; nothing is deleted)
 *
 * There is intentionally no DELETE / PUT route.
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import {
  appendIdentityVersion,
  appendMemoryEvent,
  characterOwnedBy,
  clampLedgerLimit,
  currentIdentity,
  isMissingMemorySchema,
  listRecallLedger,
  memoryHealth,
  recallMemories,
  RecallLedgerCursorError,
  retractMemory,
} from "../lib/memoryCore/memoryCore";

const router = Router();
router.use(rateLimit);

/** Event types a client may write directly. Server-only types are excluded. */
const CLIENT_EVENT_TYPES = new Set(["note", "milestone", "decision", "emotional_beat"]);

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function fail(res: Response, err: unknown): void {
  if (isMissingMemorySchema(err)) {
    res.status(503).json({ error: "Memory core is not migrated yet.", code: "memory_schema_missing" });
    return;
  }
  const e = err as { message?: string; code?: string };
  res.status(500).json({ error: e?.message || "Memory core request failed.", code: e?.code || "server_error" });
}

router.get("/:characterId/health", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    res.setHeader("Cache-Control", "private, max-age=30");
    res.json({ health: await memoryHealth(userId, String(req.params.characterId)) });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * "Why she said that" recall ledger (docs/recall-ledger.md). Owner-only and
 * read-only: a character that isn't the caller's returns 404, the same as one
 * that doesn't exist. Never recalls, embeds or snapshots.
 */
router.get("/:characterId/recalls", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const userId = requireUser(req, res);
  if (!userId) return;
  const characterId = String(req.params.characterId || "");
  const notFound = () => res.status(404).json({ error: "Companion not found", code: "companion_not_found" });
  if (!characterId || characterId.length > 120) return void notFound();
  const q = req.query as Record<string, unknown>;
  const session = q.session_id;
  if (session !== undefined && (typeof session !== "string" || !session || session.length > 200)) {
    res.status(400).json({ error: "session_id must be a non-empty string (max 200 chars)", code: "invalid_session_id" });
    return;
  }
  const cursor = q.cursor;
  if (cursor !== undefined && typeof cursor !== "string") {
    res.status(400).json({ error: "Invalid cursor", code: "invalid_cursor" });
    return;
  }
  try {
    if (!(await characterOwnedBy(userId, characterId))) return void notFound();
    const page = await listRecallLedger({
      userId,
      characterId,
      limit: clampLedgerLimit(q.limit),
      cursor: cursor || null,
      sessionId: typeof session === "string" ? session : null,
    });
    res.json(page);
  } catch (err) {
    if (err instanceof RecallLedgerCursorError) {
      res.status(400).json({ error: "Invalid cursor", code: "invalid_cursor" });
      return;
    }
    if (isMissingMemorySchema(err)) {
      res.status(503).json({ error: "Memory core is not migrated yet.", code: "memory_schema_missing" });
      return;
    }
    res.status(500).json({ error: "Recall ledger request failed.", code: "server_error" });
  }
});

router.post("/:characterId/bootstrap", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const characterId = String(req.params.characterId);
  try {
    const [identity, memories, health] = await Promise.all([
      currentIdentity(userId, characterId),
      recallMemories({
        userId,
        characterId,
        query: typeof req.body?.query === "string" ? req.body.query.slice(0, 1000) : undefined,
        limit: Number(req.body?.limit) || 12,
        sessionId: typeof req.body?.sessionId === "string" ? req.body.sessionId : null,
      }),
      memoryHealth(userId, characterId),
    ]);
    res.json({ identity, memories, health });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:characterId/events", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const b = (req.body || {}) as Record<string, unknown>;
  const type = String(b.event_type || "");
  if (!CLIENT_EVENT_TYPES.has(type) || typeof b.content !== "string" || !b.content.trim()) {
    res.status(400).json({ error: "event_type (note|milestone|decision|emotional_beat) and content are required" });
    return;
  }
  try {
    const id = await appendMemoryEvent({
      userId,
      characterId: String(req.params.characterId),
      eventType: type,
      content: b.content,
      payload: b.payload && typeof b.payload === "object" ? (b.payload as Record<string, unknown>) : {},
      emotionalWeight: typeof b.emotional_weight === "number" ? b.emotional_weight : 0.5,
      conversationId: typeof b.conversation_id === "string" ? b.conversation_id : null,
      messageId: typeof b.message_id === "string" ? b.message_id : null,
      dedupeKey: typeof b.dedupe_key === "string" ? `client:${b.dedupe_key.slice(0, 120)}` : null,
      source: "client",
    });
    res.status(201).json({ id });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:characterId/identity", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const b = (req.body || {}) as Record<string, any>;
  if (typeof b.name !== "string" || !b.name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const identity = await appendIdentityVersion({
      userId,
      characterId: String(req.params.characterId),
      name: b.name.slice(0, 120),
      personalityMatrix: b.personality_matrix ?? null,
      voice: b.voice ?? null,
      coreTraits: Array.isArray(b.core_traits) ? b.core_traits.slice(0, 64) : null,
      relationships: b.relationships ?? null,
      backstory: typeof b.backstory === "string" ? b.backstory.slice(0, 6000) : null,
      changeNote: typeof b.change_note === "string" ? b.change_note.slice(0, 300) : "",
    });
    res.status(201).json({ identity });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:characterId/retract", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const eventId = String(req.body?.event_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    res.status(400).json({ error: "event_id is required" });
    return;
  }
  try {
    const id = await retractMemory(userId, String(req.params.characterId), eventId, String(req.body?.reason || "").slice(0, 300));
    res.status(201).json({ id });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
