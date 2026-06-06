import { Router, type Request, type Response } from "express";
import { migrateUserData } from "@workspace/db";

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

export default router;
