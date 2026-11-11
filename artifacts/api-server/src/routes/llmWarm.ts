import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  warmLocalLlmForAppOpen,
  type AppOpenLlmWarmResult,
} from "../lib/localLlmWarm";

const router = Router();

const SILENT_MISS: AppOpenLlmWarmResult = { ok: false, warmed: false };

function signedInUserId(req: Request): string | null {
  try {
    const userId = getAuth(req).userId;
    return typeof userId === "string" && userId.trim() ? userId : null;
  } catch {
    return null;
  }
}

/**
 * One native Ollama preload for a signed-in app open.
 * The body is only ok / warmed / skipped — never the model URL or key.
 */
router.post("/warm", async (req: Request, res: Response) => {
  if (!signedInUserId(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  let result: AppOpenLlmWarmResult = SILENT_MISS;
  try {
    result = await warmLocalLlmForAppOpen();
  } catch {
    result = SILENT_MISS;
  }
  if (result.warmed) {
    // She is awake again: answer anything queued while she was resting.
    void import("../lib/restingMode")
      .then(({ deliverRestingQueue }) => deliverRestingQueue())
      .catch(() => {});
  }
  res.setHeader("Cache-Control", "no-store");
  // `resting` lets the app show the in-character resting state on open.
  res.status(200).json({ ...result, resting: result.ok === false && !result.skipped });
});

export default router;
