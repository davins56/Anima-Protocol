import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  ensureSchemaOnce,
  getPool,
  inspectSchema,
  withTransientDbRetry,
} from "@workspace/db";
import { runtimeEnvPresence } from "../lib/cloudflareEnv";
import {
  classifyDbError,
  databaseTargetHint,
  secretFreeErrorSignal,
} from "../lib/dbErrors";
import { getLlmRoutingStatus, probeLlmProviders } from "../lib/llmFailover";
import { readRuntimeEnv } from "../lib/cloudflareEnv";
import {
  buildClerkKeyReport,
  clerkDiagnosticStatus,
  probeClerkInstance,
  summarizeClerkProbe,
} from "../lib/clerkDiagnostics";
import { configuredOpsSecrets, matchesOpsBearer, requireOpsBearer } from "../lib/opsAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Health access model (security audit 2026-11-14, M1):
 *
 * - `GET /healthz` is the public liveness ping (platform startup probes,
 *   Cloud Run, the client's "API reachable" hint). It never touches a secret.
 * - `GET /healthz/llm` and `GET /healthz/clerk` answer the public with a bare
 *   status only (`/healthz/llm` also keeps `chain`, which the client reads to
 *   decide whether the model is local-only). Full diagnostics need the ops
 *   bearer (ADMIN_MIGRATION_SECRET or CRON_SECRET, constant-time compare).
 * - `?probe=1` (live provider / Clerk Backend API calls) and `/healthz/env`,
 *   `/healthz/db`, `/healthz/schema` are ops-only.
 * - No response carries a key tail any more.
 */
function wantsProbe(query: Record<string, unknown>): boolean {
  const probe = query.probe;
  return probe === "1" || probe === "true" || probe === "yes";
}

/** True for a request carrying a valid ops bearer. */
function isOpsRequest(req: Parameters<typeof matchesOpsBearer>[0]): boolean {
  return configuredOpsSecrets().length > 0 && matchesOpsBearer(req);
}

// Do not throw on missing DATABASE_URL / CLERK_SECRET_KEY at import time.
// Cloudflare Workers instantiate this module before secrets are copied from
// env bindings into process.env; /healthz must stay loadable without them.
// Routes that actually talk to Postgres (below) still fail at request time.

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Presence-only env probe. Never returns secret values — only whether the
 * isolate can see DATABASE_URL / Clerk keys after request-time remirror.
 */
router.get("/healthz/env", requireOpsBearer, (_req, res) => {
  res.json(runtimeEnvPresence());
});

/**
 * Public LLM routing probe (no secrets). Shows which chat provider chain will
 * be used so we can confirm Gemini-first / failover deploys without reading
 * Vercel env UI. API-key-like ANIMA_LLM_PROVIDER values are redacted.
 *
 * Add `?probe=1` to live-test each configured provider with a tiny completion
 * and return secret-free per-provider ok/auth/quota results.
 */
router.get("/healthz/llm", async (req, res) => {
  const routing = getLlmRoutingStatus("standard");
  const httpStatus = routing.status === "ok" ? 200 : 503;
  const probe = wantsProbe(req.query as Record<string, unknown>);

  if (!probe && !isOpsRequest(req)) {
    // Public: status + chain only. The client's local-only guard reads
    // `chain`; hosts, models, gateway names and quota state stay private.
    res.status(httpStatus).json({ status: routing.status, chain: routing.chain });
    return;
  }
  if (!probe) {
    res.status(httpStatus).json(routing);
    return;
  }

  // A live probe calls every configured provider with a real key: ops only.
  requireOpsBearer(req, res, async () => {
    try {
      // Probe the routine chat tier (standard). Light used to report Gemini as
      // dead solely because gemini-2.5-flash-lite is blocked for new AI Studio keys.
      const probes = await probeLlmProviders("standard");
      const anyOk = probes.some((p) => p.ok);
      res.status(anyOk || routing.status === "ok" ? 200 : 503).json({
        ...routing,
        probes,
        probeOk: anyOk,
      });
    } catch (err) {
      res.status(503).json({
        ...routing,
        probeOk: false,
        probeError: err instanceof Error ? err.message : String(err),
      });
    }
  });
});

/**
 * Public Clerk configuration probe (no secrets — key tails, hostnames, and
 * JWKS `kid`s only).
 *
 * `/healthz/env` reports only presence booleans, which cannot tell "the Clerk
 * secrets are set" apart from "the Clerk secrets belong to a different
 * instance than the publishable key". The latter is the silent failure that
 * reads as "the app doesn't register my login": Clerk signs the user in
 * against the real Frontend API, then `getAuth(req)` yields no userId and
 * every authenticated route 401s — including all of /api/chat/*, which is why
 * the companions stop responding.
 *
 * Add `?probe=1` to prove instance identity by intersecting the JWKS key ids
 * from the Backend API (derived from CLERK_SECRET_KEY) and the Frontend API
 * (derived from CLERK_PUBLISHABLE_KEY). Disjoint sets = mismatched keys.
 */
router.get("/healthz/clerk", async (req, res) => {
  const report = buildClerkKeyReport(req);
  const probe = wantsProbe(req.query as Record<string, unknown>);

  if (!probe && !isOpsRequest(req)) {
    // Public: bare status only (no instance type, hosts, pairing or notes).
    const { status, httpStatus } = clerkDiagnosticStatus(report);
    res.status(httpStatus).json({ status });
    return;
  }
  if (!probe) {
    const { status, httpStatus } = clerkDiagnosticStatus(report);
    res.status(httpStatus).json({ status, ...report });
    return;
  }

  // ?probe=1 calls the Clerk Backend API with CLERK_SECRET_KEY: ops only.
  requireOpsBearer(req, res, async () => {
    try {
      const probeReport = await probeClerkInstance(
        report,
        readRuntimeEnv("CLERK_SECRET_KEY"),
      );
      const { status, httpStatus } = clerkDiagnosticStatus(report, probeReport);
      res.status(httpStatus).json({
        status,
        ...report,
        probe: probeReport,
        summary: summarizeClerkProbe(report, probeReport),
      });
    } catch (err) {
      const { status, httpStatus } = clerkDiagnosticStatus(report);
      res.status(httpStatus === 200 ? 503 : httpStatus).json({
        status,
        ...report,
        probeError: err instanceof Error ? err.message : String(err),
      });
    }
  });
});

/**
 * Readiness probe that actually opens a Postgres connection and inspects the
 * schema. Ops-only (bearer): it used to be public and ran `ensureSchemaOnce()`
 * (CREATE … IF NOT EXISTS) on every call. It is inspect-only now; schema
 * creation stays on the lazy store/chat paths and `POST /healthz/schema`.
 */
router.get("/healthz/db", requireOpsBearer, async (_req, res) => {
  const target = databaseTargetHint();
  try {
    const result = await withTransientDbRetry(() =>
      getPool().query("select 1::int as ok"),
    );
    let schema: Awaited<ReturnType<typeof inspectSchema>> | null = null;
    try {
      schema = await withTransientDbRetry(() => inspectSchema());
    } catch (err) {
      logger.error({ err }, "Database health check could not inspect the schema");
    }
    const healthy = Boolean(schema?.ok);
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "error",
      db: true,
      ok: result.rows?.[0]?.ok === 1,
      ...(healthy
        ? {}
        : { reason: "schema" as const, code: "schema_missing" }),
      schema,
      target,
    });
  } catch (err) {
    // This catch only wraps getPool().query — any throw is a DB/Hyperdrive
    // failure, even when classifyDbError cannot name the driver code.
    const info = classifyDbError(err);
    const signal = secretFreeErrorSignal(err);
    res.status(503).json({
      status: "error",
      db: false,
      error: info.isDbError ? info.safeMessage : "Database unavailable",
      reason: info.isDbError ? info.reason : "unavailable",
      code: info.code || signal.code || "unavailable",
      signal: signal.signal,
      target,
    });
  }
});

/**
 * Schema inspect + optional self-heal.
 * - GET  → inspect only
 * - POST → run idempotent ensureSchemaOnce() (CREATE IF NOT EXISTS)
 *
 * Both are operator-only. Health mounts before Clerk, so this uses the same
 * ADMIN_MIGRATION_SECRET / CRON_SECRET bearer as `/api/admin/ensure-schema`.
 */
router.get("/healthz/schema", requireOpsBearer, async (_req, res) => {
  const target = databaseTargetHint();
  try {
    const schema = await inspectSchema();
    res.status(schema.ok ? 200 : 503).json({
      status: schema.ok ? "ok" : "error",
      schema,
      target,
    });
  } catch (err) {
    const info = classifyDbError(err);
    res.status(503).json({
      status: "error",
      error: info.safeMessage,
      reason: info.reason,
      code: info.code,
      target,
    });
  }
});

router.post("/healthz/schema", requireOpsBearer, async (_req, res) => {
  const target = databaseTargetHint();
  try {
    const result = await ensureSchemaOnce();
    res.status(result.ok ? 200 : 503).json({
      status: result.ok ? "ok" : "error",
      ensured: result,
      target,
    });
  } catch (err) {
    const info = classifyDbError(err);
    res.status(503).json({
      status: "error",
      error: info.safeMessage,
      reason: info.reason,
      code: info.code,
      target,
    });
  }
});

export default router;
