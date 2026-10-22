/**
 * Immersive sim (4D net battle) — server-validated consequence log.
 *   POST /api/sim/sessions                  { character_id, node_id?, start_w? } → { session } (seed + config fixed here)
 *   GET  /api/sim/sessions/:id              → { session, actions }
 *   POST /api/sim/sessions/:id/actions      { from_idx, actions: [{tick, action}], claimed?: {tick, hash} }
 *        Replays the whole append-only log with @workspace/sim-core; 409 on desync/cheat.
 *        Validated corruption / purify / outcome are appended to memory_events.
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { appendSimActions, createSimSession, getSimSession, SimError } from "../lib/sim/simStore";

const router = Router();
router.use(rateLimit);

function uid(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; code?: string; message?: string };
  if (e?.code === "42P01" || e?.code === "42883") {
    res.status(503).json({ error: "Sim tables are not migrated yet.", code: "sim_schema_missing" });
    return;
  }
  if (err instanceof SimError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ error: e?.message || "Sim request failed." });
}

router.post("/sessions", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    res.status(201).json(await createSimSession(userId, req.body || {}));
  } catch (err) {
    fail(res, err);
  }
});

router.get("/sessions/:id", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    res.json(await getSimSession(userId, String(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/sessions/:id/actions", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    res.json(await appendSimActions(userId, String(req.params.id), req.body || {}));
  } catch (err) {
    fail(res, err);
  }
});

export default router;
