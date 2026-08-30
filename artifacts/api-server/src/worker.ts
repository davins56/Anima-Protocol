import { httpServerHandler } from "cloudflare:node";
import app from "./app";
import { mirrorCloudflareBindings } from "./lib/cloudflareEnv";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  [key: string]: unknown;
}

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
      // Mirror Worker secrets/vars into process.env. Must read known secret
      // names by property — Object.entries(env) skips non-enumerable bindings
      // and would leave Clerk/Postgres unset (503 "API is misconfigured").
      mirrorCloudflareBindings(env);
      return expressHandler.fetch(request, env, ctx);
    }

    // Everything else: serve static assets (SPA fallback handled by
    // assets.not_found_handling = "single-page-application" in wrangler.jsonc).
    // /api and /api/* are run_worker_first so they never hit that SPA fallback.
    return env.ASSETS.fetch(request);
  },
};
