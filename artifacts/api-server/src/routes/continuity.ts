/** GET /api/continuity/:characterId?surface=chat|photo|vessel|resonance|home&tz_offset=&name= */
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { asSurface, presenceLabel } from "../lib/continuity/continuityCore";
import { emptyState, sessionStart } from "../lib/continuity/continuityStore";
import { createRateLimit } from "../lib/rateLimit";

const router: IRouter = Router();
const limit = createRateLimit({ name: "continuity", max: 120 });

router.get("/:characterId", limit, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const characterId = String(req.params.characterId || "").slice(0, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(characterId)) {
    res.status(400).json({ error: "Bad character id" });
    return;
  }
  const name = String(req.query.name || "She").replace(/[^\p{L}\p{N} .'-]/gu, "").slice(0, 40) || "She";
  const surface = asSurface(req.query.surface);
  try {
    const out = await sessionStart({
      userId,
      characterId,
      name,
      surface,
      tzOffsetMinutes: req.query.tz_offset == null ? null : Number(req.query.tz_offset),
    });
    res.json({ ...out, presence_label: presenceLabel(out.presence, name) });
  } catch (err) {
    // Continuity is decoration: never break a surface over it.
    console.warn("[continuity] load failed:", (err as Error)?.message);
    res.json({ state: emptyState(characterId), presence: "resting", presence_label: presenceLabel("resting", name), greeting: null, degraded: true });
  }
});

export default router;
