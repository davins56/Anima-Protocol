/**
 * /api/senses — the steward's device reports what it chooses to share
 * (switch `senses`, ANIMA_KERNEL_SENSES; see lib/kernel/senses.ts).
 *
 * PUT    store the latest snapshot (refused while the switch is off)
 * GET    non-identifying summary of what is stored (never calendar titles)
 * DELETE forget the snapshot
 */
import { getAuth } from "@clerk/express";
import { Router, type Request, type Response } from "express";
import { summarizeSenses } from "../lib/kernel/senses";
import { clearSenses, loadSenses, saveSenses } from "../lib/kernel/sensesStore";
import { isKernelFeatureEnabled } from "../lib/kernelFeatures";

const router = Router();
const MAX_BODY_BYTES = 16 * 1024;

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

router.get("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const enabled = isKernelFeatureEnabled("senses");
    const snap = enabled ? await loadSenses(userId) : null;
    res.json({ enabled, ...summarizeSenses(snap) });
  } catch (err) {
    console.error("GET /api/senses failed:", err);
    res.status(500).json({ error: "Failed to load senses" });
  }
});

router.put("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!isKernelFeatureEnabled("senses")) {
    res.status(409).json({ error: "Senses are switched off", enabled: false });
    return;
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Expected a JSON object" });
    return;
  }
  if (JSON.stringify(req.body).length > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Snapshot too large" });
    return;
  }
  try {
    const snap = await saveSenses(userId, req.body);
    res.json({ enabled: true, ...summarizeSenses(snap) });
  } catch (err) {
    console.error("PUT /api/senses failed:", err);
    res.status(500).json({ error: "Failed to save senses" });
  }
});

router.delete("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    await clearSenses(userId);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/senses failed:", err);
    res.status(500).json({ error: "Failed to clear senses" });
  }
});

export default router;
