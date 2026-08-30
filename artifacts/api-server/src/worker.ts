import "./lib/cloudflareEnvBootstrap";
import { httpServerHandler } from "cloudflare:node";
import { env as importableWorkerEnv } from "cloudflare:workers";
import app from "./app";
import {
  applyCloudflareRequestEnv,
  bindImportableEnv,
} from "./lib/cloudflareEnv";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  [key: string]: unknown;
}

bindImportableEnv(importableWorkerEnv);

// cloudflare:node uses this as a routing key, not a real bind. Passing { app }
// without listen() fails Worker upload: "Failed to determine port for server".
const WORKER_API_PORT = 8080;
app.listen(WORKER_API_PORT);

// Expose the Express app through the Node.js HTTP server adapter so all API
// routes (auth, chat, store, etc.) work on Cloudflare Workers with nodejs_compat.
const expressHandler = httpServerHandler({ port: WORKER_API_PORT });

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route /api/* requests through the Express app.
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      // Request-time apply: fetch env + importable env, including non-enumerable
      // secrets and Secrets Store-style objects. Do not rely on a boot snapshot
      // of process.env — httpServerHandler may reset it after this returns.
      await applyCloudflareRequestEnv(env);
      return expressHandler.fetch(request, env, ctx);
    }

    // Everything else: serve static assets (SPA fallback handled by
    // assets.not_found_handling = "single-page-application" in wrangler.jsonc).
    // /api and /api/* are run_worker_first so they never hit that SPA fallback.
    return env.ASSETS.fetch(request);
  },
};
