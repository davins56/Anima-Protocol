/**
 * GET /api/account/role → { role: "admin" | "user", isSteward }
 *
 * The client renders admin / steward affordances from this answer instead of
 * a bundled email allowlist. See lib/accountRole.ts.
 */
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { rateLimit } from "../lib/rateLimit";
import { resolveAccountRole } from "../lib/accountRole";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(rateLimit);

router.get("/role", async (req, res) => {
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    res.json(await resolveAccountRole({ userId, sessionClaims }));
  } catch (err) {
    logger.warn({ err }, "Failed to resolve account role");
    res.json({ role: "user", isSteward: false });
  }
});

export default router;
