import { Router, type Request, type Response } from "express";
<<<<<<< HEAD
import { migrateUserData } from "@workspace/db";
=======
import {
  ensureSchema,
  inspectSchema,
  migrateUserData,
  resetEnsureSchemaLatch,
} from "@workspace/db";
>>>>>>> origin/main

const router = Router();

function requireMigrationSecret(
  req: Request,
  res: Response,
  next: () => void,
): void {
  const configured = process.env.ADMIN_MIGRATION_SECRET?.trim();
  if (!configured) {
    res.status(503).json({
      error:
        "ADMIN_MIGRATION_SECRET is not configured on the server.",
    });
    return;
  }
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : req.header("x-admin-migration-secret")?.trim() ?? "";
  if (!token || token !== configured) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.post(
  "/migrate-user-data",
  requireMigrationSecret,
  async (req: Request, res: Response) => {
    const body = req.body as {
      fromEmail?: string;
      toEmail?: string;
      fromUserId?: string;
      toUserId?: string;
      entityNames?: string[];
      dryRun?: boolean;
    };

    const fromEmail = body.fromEmail?.trim();
    const toEmail = body.toEmail?.trim();
    if (!fromEmail || !toEmail) {
      res.status(400).json({ error: "fromEmail and toEmail are required" });
      return;
    }

    try {
      const result = await migrateUserData({
        fromEmail,
        toEmail,
        fromUserId: body.fromUserId,
        toUserId: body.toUserId,
        entityNames: body.entityNames,
        dryRun: Boolean(body.dryRun),
      });
      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Migration failed";
      res.status(400).json({ error: message });
    }
  },
);

<<<<<<< HEAD
=======
/**
 * Force-apply the idempotent store schema (same DDL as POST /api/healthz/schema).
 * Clears the process latch so a prior failed ensure can be retried.
 */
router.post(
  "/ensure-schema",
  requireMigrationSecret,
  async (_req: Request, res: Response) => {
    try {
      resetEnsureSchemaLatch();
      const before = await inspectSchema();
      const ensured = await ensureSchema();
      res.status(ensured.ok ? 200 : 503).json({
        status: ensured.ok ? "ok" : "error",
        before,
        ensured,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Schema ensure failed";
      res.status(500).json({ error: message });
    }
  },
);

>>>>>>> origin/main
export default router;
