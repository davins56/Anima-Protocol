import { Router } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { resolveBattleModels, type BattleUnitInput } from "../lib/battleModels";

const router = Router();

router.use("/battle-models", rateLimit);
router.use("/battle-models", (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

/**
 * POST /api/battle-models/resolve
 *
 * Connection used by NetBattle to resolve 3D figure descriptors for Serenity
 * (player navi) and the opposing virus. Returns procedural R3F silhouettes
 * today; a `glb_url` field is reserved for a future image-to-3D provider.
 */
router.post("/battle-models/resolve", (req, res) => {
  const body = (req.body || {}) as {
    player?: BattleUnitInput;
    enemy?: BattleUnitInput;
  };
  res.json(resolveBattleModels({ player: body.player, enemy: body.enemy }));
});

export default router;
