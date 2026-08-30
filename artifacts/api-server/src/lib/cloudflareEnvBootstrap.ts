/**
 * Evaluate before `app.ts` so importable Worker secrets can land on
 * process.env before Express / Clerk middleware construct. Request-time
 * reads in clerkProxyMiddleware remain the source of truth — this only
 * helps isolate boot when `import { env } from "cloudflare:workers"` is
 * already populated.
 *
 * Worker-only. Do not import from the Vercel/Node entry (`index.ts`).
 */
import { env } from "cloudflare:workers";
import { bindImportableEnv, mirrorCloudflareBindings } from "./cloudflareEnv";

// Companion store / @workspace/db stay on node-pg for local + Vercel.
// This Worker entry selects postgres.js so isolates talk through Hyperdrive
// instead of opening a raw TCP Pool to hosted Postgres (ECONNRESET).
try {
  if (!process.env.ANIMA_DB_DRIVER) {
    process.env.ANIMA_DB_DRIVER = "postgres-js";
  }
} catch {
  // some isolates reject process.env assignment
}

bindImportableEnv(env);
mirrorCloudflareBindings(env);
