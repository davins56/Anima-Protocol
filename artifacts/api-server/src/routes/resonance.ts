/**
 *   GET  /api/resonance/nodes                bands + global and own nodes
 *   POST /api/resonance/nodes/sync           { companions: [{id,name}] } → companion-backed nodes
 *   POST /api/resonance/nodes                create a user node
 *   POST /api/resonance/nodes/:id/retire     soft-retire (rows are never deleted)
 *   POST /api/resonance/encounters           { node_id, tuned_frequency, signal_strength, mode, character_id?, session_id?, geo_lat?, geo_lng? }
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { createNode, listNodes, logEncounter, retireNode, syncCompanionNodes } from "../lib/resonance/resonanceStore";

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
    res.status(503).json({ error: "Resonance tables are not migrated yet.", code: "resonance_schema_missing" });
    return;
  }
  if (e?.code === "P0002" || e?.code === "22P02") {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  res.status(e?.status && e.status < 600 ? e.status : 500).json({ error: e?.message || "Resonance request failed." });
}

router.get("/nodes", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    res.setHeader("Cache-Control", "private, max-age=20");
    res.json(await listNodes(userId));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/nodes/sync", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    const list = Array.isArray(req.body?.companions) ? req.body.companions : [];
    res.json({ created: await syncCompanionNodes(userId, list.map((c: any) => ({ id: String(c?.id || ""), name: String(c?.name || "") }))) });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/nodes", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    res.status(201).json({ node: await createNode(userId, req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/nodes/:id/retire", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    res.json({ retired: await retireNode(userId, String(req.params.id)) });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/encounters", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    res.status(201).json(await logEncounter(userId, req.body || {}));
  } catch (err) {
    fail(res, err);
  }
});

export default router;
