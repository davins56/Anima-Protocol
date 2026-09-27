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
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(result);
});

export default router;
