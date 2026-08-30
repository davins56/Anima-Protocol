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

bindImportableEnv(env);
mirrorCloudflareBindings(env);
