import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  ensureSchemaOnce,
  getPool,
  inspectSchema,
} from "@workspace/db";
import { classifyDbError, databaseTargetHint } from "../lib/dbErrors";
import { getLlmRoutingStatus, probeLlmProviders } from "../lib/llmFailover";

const router: IRouter = Router();

if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
if (!process.env.CLERK_SECRET_KEY) throw new Error("Missing CLERK_SECRET_KEY");

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
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
    const probes = await probeLlmProviders("light");
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
    const result = await getPool().query("select 1::int as ok");
    let schema: Awaited<ReturnType<typeof inspectSchema>> | undefined;
    try {
      schema = await inspectSchema();
    } catch (schemaErr) {
      const info = classifyDbError(schemaErr);
      res.status(503).json({
        status: "error",
        db: true,
        ok: result.rows?.[0]?.ok === 1,
        schema: { ok: false, error: info.safeMessage, code: info.code },
        target,
      });
      return;
    }

    const healthy = schema.ok;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "error",
      db: true,
      ok: result.rows?.[0]?.ok === 1,
      schema: {
        ok: schema.ok,
        missingTables: schema.missingTables,
        presentTables: schema.presentTables,
        hasPgTrgm: schema.hasPgTrgm,
      },
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
      code: info.code,
      target,
    });
  }
});

export default router;
