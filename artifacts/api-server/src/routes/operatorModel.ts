import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  emptyOperatorModel,
  loadOperatorModel,
  mergeOperatorModel,
  normalizeOperatorModel,
  parseOperatorModelBody,
  saveOperatorModel,
} from "../lib/operatorModel";

const router = Router();

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function isObjectBody(body: unknown): boolean {
  return Boolean(body) && typeof body === "object" && !Array.isArray(body);
}

router.get("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const { model, updatedAt } = await loadOperatorModel(userId);
    res.json({
      model: model ?? emptyOperatorModel(),
      updated_at: updatedAt ? updatedAt.toISOString() : null,
    });
  } catch (err) {
    console.error("GET /api/operator-model failed:", err);
    res.status(500).json({ error: "Failed to load operator model" });
  }
});

router.put("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!isObjectBody(req.body)) {
    res.status(400).json({ error: "Expected a JSON object" });
    return;
  }
  try {
    const model = normalizeOperatorModel(parseOperatorModelBody(req.body));
    const saved = await saveOperatorModel(userId, model);
    res.json({
      model: saved.model,
      updated_at: saved.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("PUT /api/operator-model failed:", err);
    res.status(500).json({ error: "Failed to save operator model" });
  }
});

router.patch("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!isObjectBody(req.body)) {
    res.status(400).json({ error: "Expected a JSON object" });
    return;
  }
  try {
    const current = await loadOperatorModel(userId);
    const model = mergeOperatorModel(
      current.model,
      parseOperatorModelBody(req.body),
    );
    const saved = await saveOperatorModel(userId, model);
    res.json({
      model: saved.model,
      updated_at: saved.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("PATCH /api/operator-model failed:", err);
    res.status(500).json({ error: "Failed to patch operator model" });
  }
});

export default router;
