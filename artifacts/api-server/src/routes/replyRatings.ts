/**
 * /api/ratings — thumbs up/down per reply + optional better version.
 *   POST /api/ratings                 { session_id, message_id, turn_id?, character_id?, character_name?, rating: 1|-1|0, reply, better_reply?, context? }
 *   GET  /api/ratings/export?format=preferences|dpo
 *        The caller's own ratings only. preferences → @workspace/llm PreferencePairExport
 *        JSONL; dpo → modelTutor DPO JSONL. Cross-user export is intentionally absent until
 *        it can honour each user's share_for_training opt-in (see docs/pending-decisions.md).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import {
  appendRating,
  latestRatings,
  pairsToPreferenceExport,
  pairsToTutorDpoJsonl,
  parseRatingInput,
  RatingInputError,
  ratingsToPairs,
} from "../lib/replyRatings";

const router: IRouter = Router();
router.use(createRateLimit({ name: "reply-ratings", max: 120, windowMs: 60_000 }));

function uid(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function fail(res: Response, err: unknown, fallback: string) {
  if (err instanceof RatingInputError) {
    res.status(400).json({ error: err.message, code: "invalid_input" });
    return;
  }
  const code = (err as { code?: string })?.code;
  if (code === "42P01") {
    res.status(503).json({ error: "Ratings are not migrated yet.", code: "ratings_schema_missing" });
    return;
  }
  logger.warn({ err }, fallback);
  res.status(500).json({ error: fallback });
}

router.post("/", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    const row = await appendRating(userId, parseRatingInput(req.body));
    res.status(201).json({ rating: { id: row.id, message_id: row.message_id, rating: row.rating, has_better: Boolean(row.better_reply) } });
  } catch (err) {
    fail(res, err, "Could not save that rating.");
  }
});

router.get("/export", async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  try {
    const pairs = ratingsToPairs(await latestRatings(userId));
    const dpo = req.query.format === "dpo";
    const body = dpo ? pairsToTutorDpoJsonl(pairs) : pairsToPreferenceExport(pairs).map((r) => JSON.stringify(r)).join("\n");
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${dpo ? "rating_dpo.jsonl" : "rating_preferences.jsonl"}"`);
    res.send(body ? `${body}\n` : "");
  } catch (err) {
    fail(res, err, "Could not export ratings.");
  }
});

export default router;
