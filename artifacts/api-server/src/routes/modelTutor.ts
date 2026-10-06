import express, { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import { createChatCompletionWithFailover } from "../lib/llmFailover";
import { combineAbortSignals } from "../lib/chatTimeouts";
import { acquireLocalLlmBackground } from "../lib/localLlmSlot";
import { finalizeAssistantReply } from "../lib/visibleAssistantReply";
import {
  TutorInputError,
  buildDraftMessages,
  cleanDraft,
  lessonsToDpoJsonl,
  lessonsToSftJsonl,
  newLesson,
  normalizeLessonContext,
  parseLessonInput,
  MAX_NOTE_CHARS,
  MAX_REPLY_CHARS,
  type ModelLesson,
} from "../lib/modelTutor";
import {
  MAX_STORED_LESSONS,
  addAdvice,
  deleteAdvice,
  deleteLesson,
  getLesson,
  lessonCounts,
  listAdvice,
  listLessons,
  readModelTutorPrefs,
  saveLesson,
  writeModelTutorPrefs,
} from "../lib/modelTutorStore";
import {
  BLOB_CHUNK_BYTES,
  BLOB_KINDS,
  MAX_MODEL_BYTES,
  OwnModelError,
  base64ByteLength,
  blobStats,
  callerIsStewardCached,
  currentVersion,
  discardUpload,
  dispatchTrainer,
  installBaseVersion,
  mergeModelState,
  nextModelVersion,
  readModelState,
  requestRelearn,
  trainerDispatchConfigured,
  writeBlobChunk,
  type BlobKind,
  type ModelState,
  type ModelVersionEntry,
  type PendingUpload,
} from "../lib/ownModel";

/**
 * /api/tutor — the steward runs and teaches the own model (lib/ownModel.ts,
 * lib/modelTutor.ts). Every route except /status is steward-only: lessons
 * and uploads change what the model says to everyone it answers.
 */
const router: IRouter = Router();
router.use(createRateLimit({ name: "model-tutor", max: 120, windowMs: 60_000 }));

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
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.warn({ err }, fallback);
  res.status(500).json({ error: fallback });
}

function modelSummary(state: ModelState) {
  const current = currentVersion(state);
  return {
    published: Boolean(current),
    base_version: state.base_version,
    current_version: current?.version ?? null,
    config: current?.entry.config ?? state.versions[String(state.base_version)]?.config ?? null,
    versions: Object.entries(state.versions)
      .map(([version, entry]) => ({
        version: Number(version),
        kind: entry.kind,
        created_at: entry.created_at,
        lessons: entry.lessons,
        bytes: (entry.inference?.bytes ?? 0) + (entry.master?.bytes ?? 0),
      }))
      .sort((a, b) => b.version - a.version),
  };
}

function settingsOf(state: ModelState) {
  return {
    answer_everyone: state.answer_everyone,
    always_learning: state.always_learning,
    learn_from_opted_in: state.learn_from_opted_in,
  };
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
    const [state, lessons, advice, preferences] = await Promise.all([
      readModelState(),
      lessonCounts(),
      listAdvice(),
      readModelTutorPrefs(userId),
    ]);
    res.json({
      isSteward: true,
      model: modelSummary(state),
      settings: settingsOf(state),
      trainer: {
        last_run: state.trainer,
        checked_at: state.trainer_checked_at,
        dispatched_at: state.trainer_dispatched_at,
        dispatch_configured: trainerDispatchConfigured(),
        relearn_pending: state.rebuild_seq > state.rebuilt_seq,
      },
      lessons,
      advice_total: advice.length,
      preferences,
    });
  } catch (err) {
    sendError(res, err, "Could not read the Model Tutor status.");
  }
});

router.put("/settings", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<ModelState> = {};
  for (const key of ["answer_everyone", "always_learning", "learn_from_opted_in"] as const) {
    if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
  }
  try {
    if (!Object.keys(patch).length) throw new TutorInputError("Nothing to change.");
    const state = await readModelState();
    if (patch.answer_everyone && !currentVersion(state)) {
      throw new OwnModelError("Upload your model before it answers anyone.", 409, "no_model");
    }
    await mergeModelState(patch);
    res.json({ settings: settingsOf({ ...state, ...patch }) });
  } catch (err) {
    sendError(res, err, "Could not save those settings.");
  }
});

router.put("/preferences", async (req, res) => {
  const userId = await requireSteward(req, res);
  if (!userId) return;
  const enabled = (req.body as { own_model_chat?: unknown } | undefined)?.own_model_chat === true;
  try {
    if (enabled && !currentVersion(await readModelState())) {
      throw new OwnModelError("Upload your model before chatting with it.", 409, "no_model");
    }
    await writeModelTutorPrefs(userId, { own_model_chat: enabled });
    res.json({ preferences: await readModelTutorPrefs(userId) });
  } catch (err) {
    sendError(res, err, "Could not save that preference.");
  }
});

// ------------------------------------------------------------------ uploads

/**
 * A model file from server/export_web.py ("anima-model-1") is split by the
 * browser into its two parts and sent in 512 KiB chunks, base64-encoded (see
 * readBlobChunk) — small enough for any host's request limit. Nothing is
 * served until /finish checks that every byte arrived.
 */
function blobInfo(raw: unknown, withHash: boolean): { bytes: number; chunks: number; sha256?: string } {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bytes = Number(record.bytes);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_MODEL_BYTES) {
    throw new TutorInputError("The model file sizes do not look right.");
  }
  const info: { bytes: number; chunks: number; sha256?: string } = {
    bytes,
    chunks: Math.ceil(bytes / BLOB_CHUNK_BYTES),
  };
  if (withHash) {
    const sha = String(record.sha256 ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new TutorInputError("The model file checksum is missing.");
    info.sha256 = sha;
  }
  return info;
}

function modelShape(raw: unknown): Record<string, number> {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const shape: Record<string, number> = {};
  for (const key of ["vocab_size", "block_size", "n_layer", "n_head", "n_embd"]) {
    const value = Number(record[key]);
    if (!Number.isInteger(value) || value <= 0 || value > 1_000_000) {
      throw new TutorInputError("The model file's config is incomplete.");
    }
    shape[key] = value;
  }
  return shape;
}

router.post("/uploads", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const upload: PendingUpload = {
      started_at: new Date().toISOString(),
      config: modelShape(body.config),
      inference: blobInfo(body.inference, true),
      master: blobInfo(body.master, false),
    };
    const state = await readModelState();
    const version = await nextModelVersion(state);
    // Older unfinished uploads are abandoned; only one at a time.
    for (const stale of Object.keys(state.uploads)) await discardUpload(Number(stale));
    await mergeModelState({ uploads: { [String(version)]: upload } });
    res.status(201).json({ version, chunk_bytes: BLOB_CHUNK_BYTES, upload });
  } catch (err) {
    sendError(res, err, "Could not start the upload.");
  }
});

async function pendingUpload(version: number): Promise<PendingUpload> {
  const upload = (await readModelState()).uploads[String(version)];
  if (!upload) throw new OwnModelError("That upload is gone — start it again.", 404, "upload_missing");
  return upload;
}

router.put(
  "/uploads/:version/:kind/:idx",
  express.text({ type: "text/plain", limit: Math.ceil((BLOB_CHUNK_BYTES * 4) / 3) + 1024 }),
  async (req, res) => {
    if (!(await requireSteward(req, res))) return;
    const version = Number(req.params.version);
    const kind = String(req.params.kind) as BlobKind;
    const idx = Number(req.params.idx);
    try {
      if (!BLOB_KINDS.includes(kind) || !Number.isInteger(idx) || idx < 0) {
        throw new TutorInputError("Bad chunk address.");
      }
      const upload = await pendingUpload(version);
      const info = upload[kind];
      if (idx >= info.chunks) throw new TutorInputError("That chunk is past the end of the file.");
      const expected =
        idx === info.chunks - 1 ? info.bytes - BLOB_CHUNK_BYTES * (info.chunks - 1) : BLOB_CHUNK_BYTES;
      const text = typeof req.body === "string" ? req.body.trim() : "";
      if (base64ByteLength(text) !== expected) {
        throw new TutorInputError(`Chunk ${idx} should be ${expected} bytes of base64.`);
      }
      await writeBlobChunk(version, kind, idx, text);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, "Could not store that part of the model.");
    }
  },
);

router.post("/uploads/:version/finish", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  const version = Number(req.params.version);
  try {
    const upload = await pendingUpload(version);
    for (const kind of BLOB_KINDS) {
      const stats = await blobStats(version, kind);
      if (stats.chunks !== upload[kind].chunks || stats.bytes !== upload[kind].bytes) {
        throw new OwnModelError(
          `The ${kind} part is incomplete (${stats.chunks}/${upload[kind].chunks} chunks). Upload it again.`,
          409,
          "upload_incomplete",
        );
      }
    }
    const entry: ModelVersionEntry = {
      kind: "base",
      created_at: new Date().toISOString(),
      lessons: 0,
      inference: upload.inference,
      master: upload.master,
      config: upload.config,
    };
    await installBaseVersion(version, entry);
    // Lessons it already learned are queued again on the new base.
    const dispatched = await dispatchTrainer();
    res.json({ version, model: modelSummary(await readModelState()), trainer_started: dispatched });
  } catch (err) {
    sendError(res, err, "Could not publish the model.");
  }
});

router.delete("/uploads/:version", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  try {
    await discardUpload(Number(req.params.version));
    res.json({ discarded: true });
  } catch (err) {
    sendError(res, err, "Could not cancel the upload.");
  }
});

// ------------------------------------------------------------------ lessons

router.get("/lessons", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  const limit = Number(req.query.limit);
  const source = req.query.source === "auto" || req.query.source === "manual" ? req.query.source : null;
  try {
    let lessons = await listLessons(Number.isFinite(limit) && limit > 0 ? limit : 200);
    if (source) lessons = lessons.filter((l) => (l.source ?? "manual") === source);
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
    let lesson: ModelLesson = newLesson(input, userId);
    const existing = await getLesson(lesson.id);
    if (existing) {
      lesson = { ...lesson, created_date: existing.created_date };
    } else if ((await lessonCounts()).total >= MAX_STORED_LESSONS) {
      res.status(409).json({ error: `The model can hold up to ${MAX_STORED_LESSONS} lessons.` });
      return;
    }
    await saveLesson(lesson);
    const trainerStarted = await dispatchTrainer();
    res.status(201).json({ lesson, trainer_started: trainerStarted });
  } catch (err) {
    sendError(res, err, "Could not save that lesson.");
  }
});

router.post("/lessons/:id/retry", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  try {
    const lesson = await getLesson(String(req.params.id));
    if (!lesson) {
      res.status(404).json({ error: "Lesson not found." });
      return;
    }
    const next: ModelLesson = {
      ...lesson,
      status: "saved",
      attempts: 0,
      error: null,
      updated_date: new Date().toISOString(),
    };
    await saveLesson(next);
    await dispatchTrainer();
    res.json({ lesson: next });
  } catch (err) {
    sendError(res, err, "Could not queue that lesson again.");
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
    // Learned weights can't drop one lesson; relearn the rest from the base.
    const relearning = lesson.status === "learned";
    if (relearning) {
      await requestRelearn();
      await dispatchTrainer();
    }
    res.json({ deleted: true, relearning });
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
    const background = await acquireLocalLlmBackground("model-tutor", { job: "model-tutor" });
    if (!background) {
      res.status(429).json({
        error: "The companion is using the model. Try again in a moment.",
        code: "llm_busy",
      });
      return;
    }
    let completion;
    try {
    completion = await createChatCompletionWithFailover({
      tier: "light",
      maxTokens: background.maxTokens(400),
      temperature: 0.7,
      messages: buildDraftMessages({
        context: normalizeLessonContext(body.context),
        rejected: clip(body.rejected, MAX_REPLY_CHARS),
        note: clip(body.note, MAX_NOTE_CHARS),
        advice,
      }),
      signal: combineAbortSignals(AbortSignal.timeout(DRAFT_TIMEOUT_MS), background.signal),
      localOnly: true,
    });
    } finally {
      await background.release();
    }
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

/** Relearn every lesson from the base model (after deletions, or to start fresh). */
router.post("/sync", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  try {
    if (!currentVersion(await readModelState())) {
      throw new OwnModelError("Upload your model first.", 409, "no_model");
    }
    await requestRelearn();
    const trainerStarted = await dispatchTrainer();
    res.status(202).json({ relearning: true, trainer_started: trainerStarted });
  } catch (err) {
    sendError(res, err, "Could not start relearning.");
  }
});

/** Run the trainer now instead of at its next 15-minute slot. */
router.post("/learn-now", async (req, res) => {
  if (!(await requireSteward(req, res))) return;
  if (!trainerDispatchConfigured()) {
    res.status(409).json({
      error:
        "Set GITHUB_TRAINER_TOKEN on the API host to start the trainer on demand. " +
        "Until then it runs every 15 minutes.",
      code: "dispatch_not_configured",
    });
    return;
  }
  const started = await dispatchTrainer();
  res.status(started ? 202 : 429).json({
    trainer_started: started,
    ...(started ? {} : { error: "The trainer was just started — give it a minute." }),
  });
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
