import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, userEntities, makeId } from "@workspace/db";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import { callerIsProtocolSteward } from "../lib/protocolUpgradeAuth";
import {
  PROTOCOL_UPGRADE_ENTITY,
  buildUpgradeAgentPrompt,
  classifyProtocolUpgrade,
  compactUpgradeRequest,
  mapCursorRunStatus,
  UPGRADE_CONFIRM_TTL_MS,
  serenityConfirmExpiredMessage,
  serenityConfirmMessage,
  serenityDeniedMessage,
  serenityErrorMessage,
  serenityFinishedMessage,
  serenityLaunchMessage,
  serenityUnconfiguredMessage,
  stewardDisplayLabel,
  stewardUserIds,
  type ProtocolUpgradeRecord,
  type UpgradeJobStatus,
  type UpgradeScope,
} from "../lib/protocolUpgrade";
import {
  CursorCloudError,
  createCloudAgent,
  cursorApiKey,
  cursorRepoUrl,
  firstGitLinks,
  getCloudAgent,
  getCloudRun,
} from "../lib/cursorCloudAgent";

const router: IRouter = Router();
router.use(createRateLimit({ name: "protocol-upgrade", max: 20, windowMs: 60_000 }));

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function asRecord(data: unknown): ProtocolUpgradeRecord | null {
  if (!data || typeof data !== "object") return null;
  const row = data as ProtocolUpgradeRecord;
  if (!row.id) return null;
  return row;
}

async function persistUpgrade(
  userId: string,
  record: ProtocolUpgradeRecord,
): Promise<void> {
  const existing = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, PROTOCOL_UPGRADE_ENTITY),
        eq(userEntities.entityId, record.id),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(userEntities)
      .set({ data: record, updatedAt: new Date() })
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, PROTOCOL_UPGRADE_ENTITY),
          eq(userEntities.entityId, record.id),
        ),
      );
    return;
  }

  await db.insert(userEntities).values({
    userId,
    entityName: PROTOCOL_UPGRADE_ENTITY,
    entityId: record.id,
    data: record,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function loadUpgrade(
  userId: string,
  id: string,
): Promise<ProtocolUpgradeRecord | null> {
  const [row] = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, PROTOCOL_UPGRADE_ENTITY),
        eq(userEntities.entityId, id),
      ),
    )
    .limit(1);
  return asRecord(row?.data);
}

function isExpiredPending(record: ProtocolUpgradeRecord, now = Date.now()): boolean {
  if (record.status !== "awaiting_confirmation") return false;
  const expires = record.expires_at ? Date.parse(record.expires_at) : NaN;
  return !Number.isFinite(expires) || expires <= now;
}

/** Show a pending weave whose confirmation window lapsed as cancelled. */
function presentUpgrade(record: ProtocolUpgradeRecord): ProtocolUpgradeRecord {
  if (!isExpiredPending(record)) return record;
  return {
    ...record,
    status: "cancelled",
    expires_at: null,
    serenity_message: serenityConfirmExpiredMessage(),
  };
}

/**
 * Atomically move a pending weave out of awaiting_confirmation so a double
 * click (or two tabs) can't launch two Cursor agents for one request.
 */
async function claimPendingUpgrade(
  userId: string,
  record: ProtocolUpgradeRecord,
  next: ProtocolUpgradeRecord,
): Promise<boolean> {
  const rows = await db
    .update(userEntities)
    .set({ data: next, updatedAt: new Date() })
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, PROTOCOL_UPGRADE_ENTITY),
        eq(userEntities.entityId, record.id),
        sql`${userEntities.data}->>'status' = 'awaiting_confirmation'`,
      ),
    )
    .returning({ id: userEntities.entityId });
  return rows.length > 0;
}

async function requireSteward(req: Request, res: Response, userId: string): Promise<boolean> {
  const { sessionClaims } = getAuth(req);
  const steward = await callerIsProtocolSteward({ userId, sessionClaims });
  if (steward.allowed) return true;
  res.status(403).json({
    error: "Only the Protocol steward can authorize source upgrades.",
    code: "not_steward",
    serenity_message: serenityDeniedMessage(),
  });
  return false;
}

async function listUpgrades(userId: string, limit = 20): Promise<ProtocolUpgradeRecord[]> {
  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, PROTOCOL_UPGRADE_ENTITY),
      ),
    )
    .orderBy(desc(userEntities.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows
    .map((row) => asRecord(row.data))
    .filter((row): row is ProtocolUpgradeRecord => Boolean(row))
    .map(presentUpgrade);
}

async function refreshUpgrade(
  userId: string,
  record: ProtocolUpgradeRecord,
): Promise<ProtocolUpgradeRecord> {
  if (
    !record.agent_id ||
    record.status === "awaiting_confirmation" ||
    record.status === "finished" ||
    record.status === "cancelled"
  ) {
    return record;
  }
  try {
    const agent = await getCloudAgent(record.agent_id);
    const runId = record.run_id || agent.latestRunId;
    let status: UpgradeJobStatus = record.status;
    let resultSummary = record.result_summary;
    let prUrl = record.pr_url;
    let branch = record.branch;
    if (runId) {
      const run = await getCloudRun(record.agent_id, runId);
      status = mapCursorRunStatus(run.status);
      resultSummary = run.result || resultSummary;
      const links = firstGitLinks(run);
      prUrl = links.prUrl || prUrl;
      branch = links.branch || branch;
    }
    const next: ProtocolUpgradeRecord = {
      ...record,
      run_id: runId || record.run_id,
      agent_url: agent.url || record.agent_url,
      status,
      result_summary: resultSummary,
      pr_url: prUrl,
      branch,
      serenity_message:
        status === "finished"
          ? serenityFinishedMessage({ prUrl })
          : record.serenity_message,
      updated_at: new Date().toISOString(),
    };
    await persistUpgrade(userId, next).catch((err) => {
      logger.warn({ err }, "Failed to persist refreshed protocol upgrade");
    });
    return next;
  } catch (err) {
    logger.warn({ err, agentId: record.agent_id }, "Failed to refresh Cursor upgrade");
    return record;
  }
}

router.get("/capability", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { sessionClaims } = getAuth(req);
  const steward = await callerIsProtocolSteward({ userId, sessionClaims });
  res.json({
    configured: Boolean(cursorApiKey()),
    isSteward: steward.allowed,
    stewardConfigured: stewardUserIds().length > 0,
    // Display only; identity is the Clerk user id.
    stewardLabel: steward.allowed ? stewardDisplayLabel() : null,
    requiresConfirmation: true,
    repo: cursorRepoUrl().replace(/^https?:\/\//, ""),
  });
});

router.post("/classify", (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const request = compactUpgradeRequest((req.body as { request?: unknown })?.request);
  res.json(classifyProtocolUpgrade(request));
});

router.get("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const items = await listUpgrades(userId);
    res.json({ upgrades: items });
  } catch (err) {
    logger.warn({ err }, "Failed to list protocol upgrades");
    res.json({ upgrades: [] });
  }
});

router.get("/:id", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const existing = await loadUpgrade(userId, String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: "Upgrade not found" });
      return;
    }
    const refreshed = await refreshUpgrade(userId, existing);
    res.json(presentUpgrade(refreshed));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load upgrade";
    res.status(500).json({ error: message });
  }
});

router.post("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const body = (req.body || {}) as {
    request?: unknown;
    scope?: unknown;
    session_id?: unknown;
    surface?: unknown;
  };
  const request = compactUpgradeRequest(body.request);
  if (!request) {
    res.status(400).json({ error: "request is required", code: "missing_request" });
    return;
  }

  const classified = classifyProtocolUpgrade(request);
  if (!classified.isUpgrade || !classified.shouldLaunch || !classified.scope) {
    res.status(400).json({
      error: "That message is not a Protocol source upgrade.",
      code: "not_an_upgrade",
      classification: classified,
    });
    return;
  }

  const scope: UpgradeScope =
    body.scope === "interface" || body.scope === "system"
      ? body.scope
      : classified.scope;

  if (!(await requireSteward(req, res, userId))) return;

  if (!cursorApiKey()) {
    res.status(503).json({
      error: "CURSOR_API_KEY is not configured on the server.",
      code: "cursor_unconfigured",
      serenity_message: serenityUnconfiguredMessage(),
    });
    return;
  }

  // Security audit 2026-11-14 (M3): a chat message alone never starts a Cursor
  // agent. This only records the request; POST /:id/confirm (an explicit
  // click on the confirm card) launches it.
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const surface = compactUpgradeRequest(body.surface, 40) || "chat";
  const sessionId =
    typeof body.session_id === "string" && body.session_id.trim()
      ? body.session_id.trim().slice(0, 200)
      : null;
  const record: ProtocolUpgradeRecord = {
    id: makeId(),
    request,
    scope,
    status: "awaiting_confirmation",
    agent_id: null,
    run_id: null,
    agent_url: null,
    pr_url: null,
    branch: null,
    result_summary: null,
    surface,
    session_id: sessionId,
    serenity_message: serenityConfirmMessage({ scope }),
    created_at: now,
    updated_at: now,
    expires_at: new Date(nowMs + UPGRADE_CONFIRM_TTL_MS).toISOString(),
    confirmed_at: null,
  };
  try {
    await persistUpgrade(userId, record);
  } catch (err) {
    logger.warn({ err }, "Failed to persist pending protocol upgrade");
    res.status(500).json({
      error: "Could not record the upgrade request.",
      code: "persist_failed",
      serenity_message: serenityErrorMessage("I could not hold the request for your confirmation"),
    });
    return;
  }
  res.status(202).json(record);
});

router.post("/:id/cancel", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!(await requireSteward(req, res, userId))) return;
  const existing = await loadUpgrade(userId, String(req.params.id)).catch(() => null);
  if (!existing) {
    res.status(404).json({ error: "Upgrade not found" });
    return;
  }
  if (existing.status !== "awaiting_confirmation") {
    res.status(409).json({ error: "Upgrade is not awaiting confirmation", code: "not_pending", upgrade: presentUpgrade(existing) });
    return;
  }
  const next: ProtocolUpgradeRecord = {
    ...existing,
    status: "cancelled",
    expires_at: null,
    serenity_message: "I let that weave go. The source stays as it is.",
    updated_at: new Date().toISOString(),
  };
  const claimed = await claimPendingUpgrade(userId, existing, next).catch(() => false);
  if (!claimed) {
    res.status(409).json({ error: "Upgrade is not awaiting confirmation", code: "not_pending" });
    return;
  }
  res.json(next);
});

router.post("/:id/confirm", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!(await requireSteward(req, res, userId))) return;

  const existing = await loadUpgrade(userId, String(req.params.id)).catch(() => null);
  if (!existing) {
    res.status(404).json({ error: "Upgrade not found" });
    return;
  }
  if (existing.status !== "awaiting_confirmation") {
    res.status(409).json({
      error: "Upgrade is not awaiting confirmation",
      code: "not_pending",
      upgrade: presentUpgrade(existing),
    });
    return;
  }
  if (isExpiredPending(existing)) {
    res.status(410).json({
      error: "The confirmation window has expired.",
      code: "confirmation_expired",
      serenity_message: serenityConfirmExpiredMessage(),
    });
    return;
  }
  if (!cursorApiKey()) {
    res.status(503).json({
      error: "CURSOR_API_KEY is not configured on the server.",
      code: "cursor_unconfigured",
      serenity_message: serenityUnconfiguredMessage(),
    });
    return;
  }

  const confirmedAt = new Date().toISOString();
  const launching: ProtocolUpgradeRecord = {
    ...existing,
    status: "launching",
    expires_at: null,
    confirmed_at: confirmedAt,
    updated_at: confirmedAt,
  };
  let claimed = false;
  try {
    claimed = await claimPendingUpgrade(userId, existing, launching);
  } catch (err) {
    logger.warn({ err }, "Failed to claim pending protocol upgrade");
  }
  if (!claimed) {
    res.status(409).json({ error: "Upgrade is not awaiting confirmation", code: "not_pending" });
    return;
  }

  const { request, scope } = existing;
  try {
    const created = await createCloudAgent({
      prompt: buildUpgradeAgentPrompt({ request, scope }),
      name: `Serenity ${scope} upgrade`,
    });
    const agentUrl = created.agent.url || `https://cursor.com/agents/${created.agent.id}`;
    const record: ProtocolUpgradeRecord = {
      ...launching,
      status: mapCursorRunStatus(created.run?.status || "CREATING"),
      agent_id: created.agent.id,
      run_id: created.run?.id || created.agent.latestRunId || null,
      agent_url: agentUrl,
      serenity_message: serenityLaunchMessage({ scope, agentUrl }),
      updated_at: new Date().toISOString(),
    };
    await persistUpgrade(userId, record).catch((err) => {
      logger.warn({ err }, "Failed to persist protocol upgrade");
    });
    res.status(201).json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to launch upgrade";
    const failed: ProtocolUpgradeRecord = {
      ...launching,
      status: "error",
      serenity_message:
        err instanceof CursorCloudError && err.code === "cursor_unconfigured"
          ? serenityUnconfiguredMessage()
          : serenityErrorMessage(message),
      updated_at: new Date().toISOString(),
    };
    await persistUpgrade(userId, failed).catch(() => undefined);
    if (err instanceof CursorCloudError && err.code === "cursor_unconfigured") {
      res.status(503).json({
        error: err.message,
        code: err.code,
        serenity_message: serenityUnconfiguredMessage(),
      });
      return;
    }
    logger.warn({ err }, "Protocol upgrade launch failed");
    res.status(502).json({
      error: message,
      code: "cursor_error",
      serenity_message: serenityErrorMessage(message),
    });
  }
});

export default router;
