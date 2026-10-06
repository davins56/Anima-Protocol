import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, userProfiles, withTransientDbRetry } from "@workspace/db";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import { readChatTurn } from "../lib/chatTurnLedger";
import { createChatCompletionWithFailover } from "../lib/llmFailover";
import { combineAbortSignals } from "../lib/chatTimeouts";
import { acquireLocalLlmBackground } from "../lib/localLlmSlot";
import { finalizeAssistantReply } from "../lib/visibleAssistantReply";
import {
  buildTeacherMessages,
  cleanDraft,
  lessonIdFor,
  newLesson,
  normalizeLessonContext,
  MAX_CONTEXT_MESSAGES,
  MAX_REPLY_CHARS,
} from "../lib/modelTutor";
import {
  MAX_STORED_LESSONS,
  getLesson,
  lessonCounts,
  listAdvice,
  saveLesson,
  writeModelTutorPrefs,
} from "../lib/modelTutorStore";
import {
  BLOB_CHUNK_BYTES,
  OWN_MODEL_EMPTY_REPLY,
  currentVersion,
  dispatchTrainer,
  modelTutorPrefs,
  ownModelAccess,
  readBlobChunk,
  readModelState,
  type ModelState,
} from "../lib/ownModel";

/**
 * /api/model — the own model for everyone it answers:
 *
 * - GET  /config                       which version to run, and may this user
 * - GET  /v/:version/inference/:idx    the weights, 512 KiB at a time (base64)
 * - PUT  /consent                      "let the model learn from my chats"
 * - POST /auto-lesson                  queue an automatic lesson for a turn
 *
 * Steward controls (upload, switches, lessons) live under /api/tutor.
 */
const router: IRouter = Router();

/** Automatic lessons waiting for the trainer; beyond this, new ones are skipped. */
export const MAX_PENDING_AUTO_LESSONS = 200;
const TEACHER_TIMEOUT_MS = 25_000;

async function readProfile(userId: string): Promise<unknown> {
  const [row] = await withTransientDbRetry(() =>
    db
      .select({ data: userProfiles.data })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
  );
  return row?.data ?? null;
}

async function caller(req: Request, res: Response) {
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const [state, profile] = await Promise.all([readModelState(), readProfile(userId)]);
  const access = await ownModelAccess({ userId, sessionClaims, profile, state });
  return { userId, state, profile, access };
}

function publicConfig(state: ModelState) {
  const current = currentVersion(state);
  if (!current) return null;
  return {
    version: current.version,
    config: current.entry.config ?? null,
    created_at: current.entry.created_at,
    chunk_bytes: BLOB_CHUNK_BYTES,
    inference: {
      bytes: current.entry.inference.bytes,
      chunks: current.entry.inference.chunks,
      sha256: current.entry.inference.sha256 ?? null,
    },
  };
}

router.get("/config", createRateLimit({ name: "own-model-config", max: 60 }), async (req, res) => {
  try {
    const who = await caller(req, res);
    if (!who) return;
    const { state, profile, access } = who;
    const model = publicConfig(state);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      enabled: access.enabled,
      learning: access.learning,
      // Whether the consent switch in Settings means anything right now.
      learning_open: Boolean(model && state.answer_everyone && state.always_learning && state.learn_from_opted_in),
      share_for_training: modelTutorPrefs(profile).share_for_training,
      model: access.enabled ? model : null,
    });
  } catch (err) {
    logger.warn({ err }, "Own-model config failed");
    res.status(500).json({ error: "Could not read the model settings." });
  }
});

router.get(
  "/v/:version/inference/:idx",
  createRateLimit({ name: "own-model-weights", max: 240 }),
  async (req, res) => {
    const version = Number(req.params.version);
    const idx = Number(req.params.idx);
    if (!Number.isInteger(version) || version <= 0 || !Number.isInteger(idx) || idx < 0) {
      res.status(400).json({ error: "Bad chunk address." });
      return;
    }
    try {
      const who = await caller(req, res);
      if (!who) return;
      if (!who.access.enabled) {
        res.status(403).json({ error: "The own model is not switched on for this account." });
        return;
      }
      const entry = who.state.versions[String(version)];
      if (!entry || idx >= entry.inference.chunks) {
        res.status(404).json({ error: "That model version is gone. Reload to get the current one." });
        return;
      }
      const chunk = await readBlobChunk(version, "inference", idx);
      if (!chunk) {
        res.status(404).json({ error: "That model version is gone. Reload to get the current one." });
        return;
      }
      // Base64 text: see readBlobChunk. A version number is never reused, so
      // a chunk never changes.
      res.setHeader("Content-Type", "text/plain; charset=us-ascii");
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.end(chunk);
    } catch (err) {
      logger.warn({ err, version, idx }, "Own-model weights read failed");
      res.status(500).json({ error: "Could not read the model weights." });
    }
  },
);

router.put("/consent", createRateLimit({ name: "own-model-consent", max: 20 }), async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const share = (req.body as { share_for_training?: unknown } | undefined)?.share_for_training === true;
  try {
    await writeModelTutorPrefs(userId, { share_for_training: share });
    res.json({ share_for_training: share });
  } catch (err) {
    logger.warn({ err }, "Own-model consent save failed");
    res.status(500).json({ error: "Could not save that choice." });
  }
});

type Skip =
  | "not_learning"
  | "turn_not_found"
  | "not_own_model"
  | "not_learnable"
  | "already_taught"
  | "queue_full"
  | "no_better_reply"
  | "model_busy";

function skipped(res: Response, reason: Skip): void {
  res.json({ queued: false, reason });
}

/**
 * After an own-model turn, the browser asks for it to become a lesson. The
 * turn is read back from the server's own ledger: only replies the own model
 * actually gave, outside therapy and adult scenes, and only for users whose
 * chats the model may learn from (see ownModelAccess).
 */
router.post(
  "/auto-lesson",
  createRateLimit({ name: "own-model-auto-lesson", max: 12 }),
  async (req, res) => {
    const body = (req.body ?? {}) as { turn_id?: unknown; context?: unknown };
    const turnId = typeof body.turn_id === "string" ? body.turn_id.trim() : "";
    if (!turnId) {
      res.status(400).json({ error: "turn_id is required." });
      return;
    }
    try {
      const who = await caller(req, res);
      if (!who) return;
      if (!who.access.learning) return skipped(res, "not_learning");

      const turn = await readChatTurn(turnId, who.userId);
      if (!turn || !turn.assistantContent || !turn.userContent.trim()) {
        return skipped(res, "turn_not_found");
      }
      const meta = turn.metadata ?? {};
      if (meta.brand !== "own") return skipped(res, "not_own_model");
      if (meta.own_model_learnable !== true) return skipped(res, "not_learnable");

      const lessonId = lessonIdFor({
        sessionId: turn.sessionId,
        messageId: turn.assistantMessageId,
        part: 0,
      });
      if (await getLesson(lessonId)) return skipped(res, "already_taught");
      const counts = await lessonCounts();
      if (counts.auto_pending >= MAX_PENDING_AUTO_LESSONS || counts.total >= MAX_STORED_LESSONS) {
        return skipped(res, "queue_full");
      }

      // The browser sends the history it prompted with; the last user turn
      // always comes from the ledger.
      const history = normalizeLessonContext(body.context);
      const userText = turn.userContent.trim();
      const lastTurn = history[history.length - 1];
      if (lastTurn?.role === "user" && lastTurn.content === userText) history.pop();
      const context = [...history, { role: "user" as const, content: userText }].slice(
        -MAX_CONTEXT_MESSAGES,
      );

      const advice = (await listAdvice()).map((a) => a.text);
      const background = await acquireLocalLlmBackground("own-model-teacher", {
        job: "own-model-teacher",
      });
      if (!background) return skipped(res, "model_busy");
      let completion;
      try {
      completion = await createChatCompletionWithFailover({
        tier: "light",
        maxTokens: 300,
        temperature: 0.7,
        messages: buildTeacherMessages({ context, advice }),
        signal: combineAbortSignals(AbortSignal.timeout(TEACHER_TIMEOUT_MS), background.signal),
      });
      } finally {
        await background.release();
      }
      const chosen = cleanDraft(finalizeAssistantReply(completion.content));
      const rejectedRaw = turn.assistantContent.trim();
      const rejected =
        rejectedRaw && rejectedRaw !== OWN_MODEL_EMPTY_REPLY ? rejectedRaw.slice(0, MAX_REPLY_CHARS) : null;
      if (!chosen || chosen === rejected) return skipped(res, "no_better_reply");

      const lesson = newLesson(
        {
          context,
          chosen,
          rejected,
          note: null,
          session_id: turn.sessionId,
          message_id: turn.assistantMessageId,
          part: 0,
          source_brand: "own",
        },
        who.userId,
        new Date(),
        "auto",
      );
      await saveLesson(lesson);
      await dispatchTrainer();
      res.status(201).json({ queued: true, lesson_id: lesson.id });
    } catch (err) {
      logger.warn({ err }, "Own-model automatic lesson failed");
      res.status(502).json({ error: "Could not queue that lesson.", code: "auto_lesson_failed" });
    }
  },
);

export default router;
