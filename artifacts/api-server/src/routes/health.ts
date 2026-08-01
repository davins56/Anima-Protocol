import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getPool } from "@workspace/db";
import { classifyDbError, databaseTargetHint } from "../lib/dbErrors";

const router: IRouter = Router();

if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
if (!process.env.CLERK_SECRET_KEY) throw new Error("Missing CLERK_SECRET_KEY");

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Readiness probe that actually opens a Postgres connection.
 * Public (no Clerk) so operators can diagnose "Internal server error" on
 * /api/store/* without a session — /healthz alone only checks env presence.
 */
router.get("/healthz/db", async (_req, res) => {
  const target = databaseTargetHint();
  try {
    const result = await getPool().query("select 1::int as ok");
    res.json({
      status: "ok",
      db: true,
      ok: result.rows?.[0]?.ok === 1,
      target,
    });
  } catch (err) {
    const info = classifyDbError(err);
    res.status(503).json({
      status: "error",
      db: false,
      error: info.safeMessage,
      code: info.code,
      target,
    });
  }
});

export default router;
