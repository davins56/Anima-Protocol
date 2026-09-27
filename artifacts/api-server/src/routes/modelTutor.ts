import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import { createChatCompletionWithFailover } from "../lib/llmFailover";
import { finalizeAssistantReply } from "../lib/visibleAssistantReply";
import {
  TutorInputError,
  applyLearnJob,
  buildDraftMessages,
  cleanDraft,
  lessonsToDpoJsonl,
  lessonsToSftJsonl,
  newLesson,
  normalizeLessonContext,
  parseLessonInput,
  reconcileLesson,
  toOwnModelPayload,
  MAX_NOTE_CHARS,
  MAX_REPLY_CHARS,
  type ModelLesson,
} from "../lib/modelTutor";
import {
  MAX_STORED_LESSONS,
  addAdvice,
  countLessons,
  deleteAdvice,
  deleteLesson,
  getLesson,
  listAdvice,
  listLessons,
  readOwnModelChatPreference,
  saveLesson,
  writeOwnModelChatPreference,
} from "../lib/modelTutorStore";
import {
  OWN_MODEL_NOT_CONFIGURED_HINT,
  OwnModelError,
  asOwnModelError,
  callerIsStewardCached,
  forgetOwnModelLesson,
  ownModelConfigured,
  ownModelJob,
  ownModelStatus,
  rollbackOwnModel,
  syncOwnModelLessons,
  teachOwnModel,
  type OwnModelJob,
  type OwnModelStatus,
} from "../lib/ownModel";

/**
 * /api/tutor — the steward teaches their own model (see lib/modelTutor.ts).
 * Every route except /status is steward-only: lessons change the model's
 * weights, so letting any account teach would let any account poison it.
 */
const router: IRouter = Router();
router.use(createRateLimit({ name: "model-tutor", max: 60, windowMs: 60_000 }));

/** Seconds a teach call waits for learning before handing back a job to poll. */
const TEACH_WAIT_SECONDS = 15;
const DRAFT_TIMEOUT_MS = 25_000;

async function requireSteward(req: Request, res: Response): Promise<string | null> {
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!(await callerIsStewardCached({ userId, sessionClaims }))) {
    res.status(403).json({
      error: "Only the Protocol steward can teach the model.",
      code: "not_steward",
    });
    return null;
  }
  return userId;
}

function sendError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof TutorInputError) {
    res.status(400).json({ error: err.message, code: "invalid_input" });
    return;
  }
  if (err instanceof OwnModelError) {
    const status = err.code === "not_configured" ? 409 : err.status && err.status < 500 ? err.status : 502;
    res.status(status).json({ error: err.message, code: err.code ?? "own_model_error" });
    return;
  }
  logger.warn({ err }, fallback);
  res.status(500).json({ error: fallback });
}

/** A failed learning job comes back as HTTP 500 with the job in the body. */
async function readJob(call: () => Promise<OwnModelJob>): Promise<OwnModelJob> {
  try {
    return await call();
  } catch (err) {
    const body = (err as { body?: unknown }).body as Partial<OwnModelJob> | undefined;
    if (body && body.status === "failed" && typeof body.job_id === "string") {
      return body as OwnModelJob;
    }
    throw asOwnModelError(err);
  }
}

/** Make stored statuses match what the live weights actually know. */
async function reconcileLessons(status: OwnModelStatus): Promise<void> {
  if (status.training) return;
  const learned = new Set(status.learned_ids ?? []);
  const lessons = await listLessons(MAX_STORED_LESSONS);
  for (const lesson of lessons) {
    const next = reconcileLesson(lesson, learned.has(lesson.id), status.version);
    if (next) await saveLesson(next);
  }
}

function publicModelStatus(status: OwnModelStatus) {
  const { learned_ids: _ids, ...rest } = status;
  return rest;
}

router.get("/status", async (req, res) => {
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    if (!(await callerIsStewardCached({ userId, sessionClaims }))) {
      res.json({ isSteward: false });
      return;
    }
    const configured = ownModelConfigured();
    const [lessonsTotal, advice, ownModelChat] = await Promise.all([
      countLessons(),
      listAdvice(),
      readOwnModelChatPreference(userId),
    ]);
    let model: OwnModelStatus | null = null;
    let error: string | null = configured ? null : OWN_MODEL_NOT_CONFIGURED_HINT;
    if (configured) {
      try {
        model = await ownModelStatus();
        await reconcileLessons(model).catch((err) =>
          logger.warn({ err }, "Model Tutor lesson reconcile failed"),
        );
      } catch (err) {
        error = asOwnModelError(err).message;
      }
    }
    res.json({
      isSteward: true,
      configured,
      reachable: Boolean(model),
      error,
      model: model ? publicModelStatus(model) : null,
      lessons_total: lessonsTotal,
      advice_total: advice.length,
      needs_sync: Boolean(
        model &&
          !model.training &&
          (model.lessons_learned < lessonsTotal || (model.forgotten_pending ?? 0) > 0),
      ),
      preferences: { own_model_chat: ownModelChat },
    });
  } catch (err) {
    sendError(res, err, "Could not read the Model Tutor status.");
  }
});

router.put("/preferences", async (req, res) => {
  const userId = await requireSteward(req, res);
  if (!userId) return;
  const enabled = (req.body as { own_model_chat?: unknown } | undefined)?.own_model_chat === true;
  try {
    if (enabled && !ownModelConfigured()) {
      throw new OwnModelError(OWN_MODEL_NOT_CONFIGURED_HINT, { code: "not_configured" });
    }
    await writeOwnModelChatPreference(userId, enabled);
    res.json({ preferences: { own_model_chat: enabled } });
  } catch (err) {
    sendError(res, err, "Could not save that preference.");
  }
});

router.get("/lessons", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  const limit = Number(req.query.limit);
  try {
    const lessons = await listLessons(Number.isFinite(limit) && limit > 0 ? limit : 200);
    res.json({ lessons });
  } catch (err) {
    sendError(res, err, "Could not load lessons.");
  }
});

router.post("/lessons", async (req, res) => {
  const userId = await requireSteward(req, res);
  if (!userId) return;
  try {
    const input = parseLessonInput(req.body);
    let lesson = newLesson(input, userId);
    const existing = await getLesson(lesson.id);
    if (existing) {
      lesson = { ...lesson, created_date: existing.created_date };
    } else if ((await countLessons()) >= MAX_STORED_LESSONS) {
      res.status(409).json({ error: `The model can hold up to ${MAX_STORED_LESSONS} lessons.` });
      return;
    }
    if (!ownModelConfigured()) {
      await saveLesson({ ...lesson, error: OWN_MODEL_NOT_CONFIGURED_HINT });
      res.status(201).json({ lesson: { ...lesson, error: OWN_MODEL_NOT_CONFIGURED_HINT } });
      return;
    }
    lesson = { ...lesson, status: "learning" };
    await saveLesson(lesson);
    try {
      const job = await readJob(() =>
        teachOwnModel(toOwnModelPayload(lesson), TEACH_WAIT_SECONDS),
      );
      lesson = applyLearnJob(lesson, job);
    } catch (err) {
      // Saved either way: the next sync teaches it once the model is back.
      lesson = { ...lesson, status: "saved", error: asOwnModelError(err).message };
    }
    await saveLesson(lesson);
    res.status(201).json({ lesson });
  } catch (err) {
    sendError(res, err, "Could not save that lesson.");
  }
});

router.get("/jobs/:jobId", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  try {
    const job = await readJob(() => ownModelJob(String(req.params.jobId)));
    let lesson: ModelLesson | null = null;
    const lessonId = typeof req.query.lesson_id === "string" ? req.query.lesson_id : "";
    if (lessonId) {
      lesson = await getLesson(lessonId);
      if (lesson && lesson.job_id === job.job_id && (job.status === "done" || job.status === "failed")) {
        lesson = applyLearnJob(lesson, job);
        await saveLesson(lesson);
      }
    }
    res.json({ job, lesson });
  } catch (err) {
    sendError(res, err, "Could not read that learning job.");
  }
});

router.delete("/lessons/:id", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  const id = String(req.params.id);
  try {
    const lesson = await getLesson(id);
    if (!lesson) {
      res.status(404).json({ error: "Lesson not found." });
      return;
    }
    await deleteLesson(id);
    let wasLearned = lesson.status === "learned";
    if (ownModelConfigured()) {
      try {
        wasLearned = (await forgetOwnModelLesson(id)).was_learned || wasLearned;
      } catch (err) {
        logger.warn({ err, id }, "Own model did not drop a deleted lesson; the next sync will");
      }
    }
    res.json({ deleted: true, needs_sync: wasLearned });
  } catch (err) {
    sendError(res, err, "Could not delete that lesson.");
  }
});

router.post("/lessons/draft", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const clip = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
  try {
    const advice = (await listAdvice()).map((a) => a.text);
    const completion = await createChatCompletionWithFailover({
      tier: "light",
      maxTokens: 400,
      temperature: 0.7,
      messages: buildDraftMessages({
        context: normalizeLessonContext(body.context),
        rejected: clip(body.rejected, MAX_REPLY_CHARS),
        note: clip(body.note, MAX_NOTE_CHARS),
        advice,
      }),
      signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
    });
    const draft = cleanDraft(finalizeAssistantReply(completion.content));
    if (!draft) throw new Error("empty draft");
    res.json({ draft, model: completion.model, brand: completion.brand });
  } catch (err) {
    logger.warn({ err }, "Model Tutor draft failed");
    res.status(502).json({
      error: "Anima couldn't draft a better reply right now — you can still write it yourself.",
      code: "draft_failed",
    });
  }
});

router.post("/sync", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  try {
    if (!ownModelConfigured()) {
      throw new OwnModelError(OWN_MODEL_NOT_CONFIGURED_HINT, { code: "not_configured" });
    }
    const lessons = await listLessons(MAX_STORED_LESSONS);
    const job = await readJob(() => syncOwnModelLessons(lessons.map(toOwnModelPayload), 0));
    res.status(202).json({ job, lessons: lessons.length });
  } catch (err) {
    sendError(res, err, "Could not start relearning.");
  }
});

router.post("/rollback", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  try {
    if (!ownModelConfigured()) {
      throw new OwnModelError(OWN_MODEL_NOT_CONFIGURED_HINT, { code: "not_configured" });
    }
    const job = await readJob(() => rollbackOwnModel(10));
    res.json({ job });
  } catch (err) {
    sendError(res, err, "Could not undo the last lesson.");
  }
});

router.get("/advice", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  try {
    res.json({ advice: await listAdvice() });
  } catch (err) {
    sendError(res, err, "Could not load advice.");
  }
});

router.post("/advice", async (req, res) => {
  const userId = await requireSteward(req, res);
  if (!userId) return;
  try {
    const advice = await addAdvice((req.body as { text?: unknown } | undefined)?.text, userId);
    res.status(201).json({ advice });
  } catch (err) {
    sendError(res, err, "Could not save that advice.");
  }
});

router.delete("/advice/:id", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  try {
    const deleted = await deleteAdvice(String(req.params.id));
    res.status(deleted ? 200 : 404).json({ deleted });
  } catch (err) {
    sendError(res, err, "Could not delete that advice.");
  }
});

router.get("/export", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  const format = req.query.format === "dpo" ? "dpo" : "sft";
  try {
    const lessons = (await listLessons(MAX_STORED_LESSONS)).reverse();
    const body = format === "dpo" ? lessonsToDpoJsonl(lessons) : lessonsToSftJsonl(lessons);
    const filename = format === "dpo" ? "steward_preferences.jsonl" : "steward_lessons.jsonl";
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(body ? `${body}\n` : "");
  } catch (err) {
    sendError(res, err, "Could not export lessons.");
  }
});

export default router;
