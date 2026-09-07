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

const router: IRouter = Router();

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
router.get("/healthz/env", (_req, res) => {
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
  const wantProbe =
    req.query.probe === "1" ||
    req.query.probe === "true" ||
    req.query.probe === "yes";

  if (!wantProbe) {
    res.status(routing.status === "ok" ? 200 : 503).json(routing);
    return;
  }

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
  const wantProbe =
    req.query.probe === "1" ||
    req.query.probe === "true" ||
    req.query.probe === "yes";

  if (!wantProbe) {
    const { status, httpStatus } = clerkDiagnosticStatus(report);
    res.status(httpStatus).json({ status, ...report });
    return;
  }

  try {
    const probe = await probeClerkInstance(
      report,
      readRuntimeEnv("CLERK_SECRET_KEY"),
    );
    const { status, httpStatus } = clerkDiagnosticStatus(report, probe);
    res.status(httpStatus).json({
      status,
      ...report,
      probe,
      summary: summarizeClerkProbe(report, probe),
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

/**
 * Readiness probe that actually opens a Postgres connection.
 * Public (no Clerk) so operators can diagnose "Internal server error" on
 * /api/store/* without a session — /healthz alone only checks env presence.
 *
 * Also reports whether required tables exist. Connectivity can be fine while
 * the schema is missing (typical after pointing DATABASE_URL at a fresh
 * Supabase project) — that surfaces as "Database schema is missing or out of
 * date" on Character / ChatSession store calls.
 */
router.get("/healthz/db", async (_req, res) => {
  const target = databaseTargetHint();
  try {
    const result = await withTransientDbRetry(() =>
      getPool().query("select 1::int as ok"),
    );
    let schema: Awaited<ReturnType<typeof inspectSchema>> | undefined;
    try {
      schema = await inspectSchema();
    } catch (schemaErr) {
      const info = classifyDbError(schemaErr);
      res.status(503).json({
        status: "error",
        db: true,
        ok: result.rows?.[0]?.ok === 1,
        schema: {
          ok: false,
          error: info.safeMessage,
          reason: info.reason,
          code: info.code,
        },
        target,
      });
      return;
    }

    const healthy = schema.ok;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "error",
      db: true,
      ok: result.rows?.[0]?.ok === 1,
      ...(healthy
        ? {}
        : { reason: "schema" as const, code: "schema_missing" }),
      schema: {
        ok: schema.ok,
        missingTables: schema.missingTables,
        presentTables: schema.presentTables,
        hasPgTrgm: schema.hasPgTrgm,
      },
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
 * Public schema probe + optional self-heal.
 * - GET  → inspect only
 * - POST → run idempotent ensureSchemaOnce() (CREATE IF NOT EXISTS)
 *
 * Safe to expose: DDL is IF NOT EXISTS only, no data mutation, no secrets
 * returned. Lets production recover from a blank Supabase without needing
 * drizzle-kit credentials on an operator laptop.
 */
router.get("/healthz/schema", async (_req, res) => {
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

router.post("/healthz/schema", async (_req, res) => {
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
