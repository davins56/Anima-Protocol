/**
 * Cyberworld journey memory hookup (pairs with PR #721).
 *
 *   POST /api/memory/journey-events     { events: Row[] }  (max 20, insert-only)
 *   GET  /api/memory/journey-interests?character_id=
 *
 * user_id is taken only from the session. There is no UPDATE or DELETE route.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { insertJourneyEvents, loadJourneyInterests } from "../lib/memoryCore/journeyEvents";

const router: IRouter = Router();
router.use(rateLimit);

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

router.post("/journey-events", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const result = await insertJourneyEvents(userId, req.body ?? {});
    if (!result.ok) {
      if (result.status === 429) res.setHeader("Retry-After", String((result.body.retry_after as number) || 1));
      res.status(result.status).json(result.body);
      return;
    }
    res.status(200).json({
      inserted: result.inserted,
      duplicates: result.duplicates,
      rejected: result.rejected,
    });
  } catch (err) {
    console.warn("[journey-events] insert failed:", (err as Error)?.message);
    res.status(500).json({ error: "Journey events failed" });
  }
});

router.get("/journey-interests", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const result = await loadJourneyInterests(userId, String(req.query.character_id || ""));
    if ("status" in result) {
      res.status(result.status).json(result.body);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  } catch (err) {
    console.warn("[journey-interests] load failed:", (err as Error)?.message);
    res.status(500).json({ error: "Journey interests failed" });
  }
});

export default router;
