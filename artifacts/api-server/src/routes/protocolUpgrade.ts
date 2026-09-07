import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq } from "drizzle-orm";
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
  serenityDeniedMessage,
  serenityErrorMessage,
  serenityFinishedMessage,
  serenityLaunchMessage,
  serenityUnconfiguredMessage,
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
  return rows.map((row) => asRecord(row.data)).filter((row): row is ProtocolUpgradeRecord => Boolean(row));
}

async function refreshUpgrade(
  userId: string,
  record: ProtocolUpgradeRecord,
): Promise<ProtocolUpgradeRecord> {
  if (!record.agent_id || record.status === "finished" || record.status === "cancelled") {
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
    res.json(refreshed);
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

  const { sessionClaims } = getAuth(req);
  const steward = await callerIsProtocolSteward({ userId, sessionClaims });
  if (!steward.allowed) {
    res.status(403).json({
      error: "Only the Protocol steward can authorize source upgrades.",
      code: "not_steward",
      serenity_message: serenityDeniedMessage(),
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

  const now = new Date().toISOString();
  const id = makeId();
  const surface = compactUpgradeRequest(body.surface, 40) || "chat";
  const sessionId =
    typeof body.session_id === "string" && body.session_id.trim()
      ? body.session_id.trim()
      : null;

  try {
    const created = await createCloudAgent({
      prompt: buildUpgradeAgentPrompt({ request, scope }),
      name: `Serenity ${scope} upgrade`,
    });
    const record: ProtocolUpgradeRecord = {
      id,
      request,
      scope,
      status: mapCursorRunStatus(created.run?.status || "CREATING"),
      agent_id: created.agent.id,
      run_id: created.run?.id || created.agent.latestRunId || null,
      agent_url: created.agent.url || `https://cursor.com/agents/${created.agent.id}`,
      pr_url: null,
      branch: null,
      result_summary: null,
      surface,
      session_id: sessionId,
      serenity_message: serenityLaunchMessage({
        scope,
        agentUrl: created.agent.url || `https://cursor.com/agents/${created.agent.id}`,
      }),
      created_at: now,
      updated_at: now,
    };
    await persistUpgrade(userId, record).catch((err) => {
      logger.warn({ err }, "Failed to persist protocol upgrade");
    });
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof CursorCloudError && err.code === "cursor_unconfigured") {
      res.status(503).json({
        error: err.message,
        code: err.code,
        serenity_message: serenityUnconfiguredMessage(),
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to launch upgrade";
    logger.warn({ err }, "Protocol upgrade launch failed");
    res.status(502).json({
      error: message,
      code: "cursor_error",
      serenity_message: serenityErrorMessage(message),
    });
  }
});

export default router;
