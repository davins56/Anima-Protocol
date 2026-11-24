/**
 * /api/bug-squasher — automatic + manual bug reports and the admin triage API.
 *
 *   POST  /api/bug-squasher/reports                      any signed-in user (ingest)
 *   GET   /api/bug-squasher/reports/mine                 the caller's own reports
 *   GET   /api/bug-squasher/admin/groups?status=&q=      admin: grouped by fingerprint
 *   GET   /api/bug-squasher/admin/groups/:fingerprint    admin: rows in one group
 *   PATCH /api/bug-squasher/admin/groups/:fingerprint    admin: { status, note? }
 *   GET   /api/bug-squasher/admin/reports/:id/screenshot admin: the attached image
 *
 * Admin = lib/accountRole.ts (steward, ANIMA_ADMIN_USER_IDS, ANIMA_ADMIN_EMAILS).
 * Before the migration is applied every route answers 503
 * `bug_squasher_schema_missing` and the client stops sending.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import { resolveAccountRole } from "../lib/accountRole";
import {
  BugReportInputError,
  isBugStatus,
  isFingerprint,
  parseBugReport,
  parseStatusUpdate,
} from "../lib/bugSquasher/ingest";
import {
  BugReportQuotaError,
  BugSquasherSchemaMissingError,
  getBugGroupReports,
  getBugScreenshot,
  ingestBugReport,
  listBugGroups,
  listMyBugReports,
  setBugGroupStatus,
} from "../lib/bugSquasher/store";

const router: IRouter = Router();

const limitIngest = createRateLimit({ name: "bug-squasher-ingest", max: 30, windowMs: 60_000 });
const limitRead = createRateLimit({ name: "bug-squasher-read", max: 120, windowMs: 60_000 });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signedInUserId(req: Request): string | null {
  try {
    const userId = getAuth(req).userId;
    return typeof userId === "string" && userId.trim() ? userId : null;
  } catch {
    return null;
  }
}

function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = signedInUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.locals.bugSquasherUserId = userId;
  res.setHeader("Cache-Control", "private, no-store");
  next();
}

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = res.locals.bugSquasherUserId as string;
  try {
    const { sessionClaims } = getAuth(req);
    const role = await resolveAccountRole({ userId, sessionClaims });
    if (role.role !== "admin") {
      res.status(403).json({ error: "Bug Squasher triage is for admins.", code: "forbidden" });
      return;
    }
    next();
  } catch (err) {
    logger.warn({ err }, "bug squasher admin check failed");
    res.status(403).json({ error: "Bug Squasher triage is for admins.", code: "forbidden" });
  }
}

function fail(res: Response, err: unknown, fallback: string): void {
  if (err instanceof BugReportInputError) {
    res.status(400).json({ error: err.message, code: "invalid_input" });
    return;
  }
  if (err instanceof BugSquasherSchemaMissingError) {
    res.status(503).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof BugReportQuotaError) {
    res.status(429).json({ error: err.message, code: err.code });
    return;
  }
  logger.warn({ err }, fallback);
  res.status(500).json({ error: fallback });
}

function headerUserAgent(req: Request): string {
  const raw = req.headers["user-agent"];
  return typeof raw === "string" ? raw : "";
}

router.post("/reports", requireUser, limitIngest, async (req, res) => {
  const userId = res.locals.bugSquasherUserId as string;
  try {
    const input = parseBugReport(req.body, { userAgent: headerUserAgent(req) });
    const result = await ingestBugReport(userId, input);
    if (result.reopened) {
      logger.info({ fingerprint: result.fingerprint, kind: input.kind }, "bug_squasher_reopened");
    }
    res.status(result.inserted ? 201 : 200).json({
      report: {
        id: result.id,
        fingerprint: result.fingerprint,
        status: result.status,
        count: result.count,
        reopened: result.reopened,
      },
    });
  } catch (err) {
    fail(res, err, "Could not save that bug report.");
  }
});

router.get("/reports/mine", requireUser, limitRead, async (_req, res) => {
  const userId = res.locals.bugSquasherUserId as string;
  try {
    res.json({ reports: await listMyBugReports(userId) });
  } catch (err) {
    fail(res, err, "Could not load your bug reports.");
  }
});

router.use("/admin", requireUser, limitRead, requireAdmin);

router.get("/admin/groups", async (req, res) => {
  const status = isBugStatus(req.query.status) ? req.query.status : null;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Number(req.query.limit) || 100;
  try {
    res.json({ groups: await listBugGroups({ status, q, limit }) });
  } catch (err) {
    fail(res, err, "Could not load bugs.");
  }
});

router.get("/admin/groups/:fingerprint", async (req, res) => {
  const fingerprint = String(req.params.fingerprint || "");
  if (!isFingerprint(fingerprint)) {
    res.status(400).json({ error: "Invalid fingerprint", code: "invalid_input" });
    return;
  }
  try {
    const reports = await getBugGroupReports(fingerprint);
    if (!reports.length) {
      res.status(404).json({ error: "No such bug", code: "not_found" });
      return;
    }
    res.json({ fingerprint, reports });
  } catch (err) {
    fail(res, err, "Could not load that bug.");
  }
});

router.patch("/admin/groups/:fingerprint", async (req, res) => {
  const fingerprint = String(req.params.fingerprint || "");
  if (!isFingerprint(fingerprint)) {
    res.status(400).json({ error: "Invalid fingerprint", code: "invalid_input" });
    return;
  }
  try {
    const update = parseStatusUpdate(req.body);
    const actor = res.locals.bugSquasherUserId as string;
    const updated = await setBugGroupStatus(fingerprint, update.status, { note: update.note, actor });
    if (!updated) {
      res.status(404).json({ error: "No such bug", code: "not_found" });
      return;
    }
    res.json({ fingerprint, status: update.status, updated });
  } catch (err) {
    fail(res, err, "Could not update that bug.");
  }
});

router.get("/admin/reports/:id/screenshot", async (req, res) => {
  const id = String(req.params.id || "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid id", code: "invalid_input" });
    return;
  }
  try {
    const screenshot = await getBugScreenshot(id);
    if (!screenshot) {
      res.status(404).json({ error: "No screenshot", code: "not_found" });
      return;
    }
    res.json({ screenshot });
  } catch (err) {
    fail(res, err, "Could not load that screenshot.");
  }
});

export default router;
