import { httpServerHandler } from "cloudflare:node";
import app from "./app";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  [key: string]: unknown;
}

// Expose the Express app through the Node.js HTTP server adapter so all API
// routes (auth, chat, store, etc.) work on Cloudflare Workers with nodejs_compat.
const expressHandler = httpServerHandler({ app });

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route /api/* requests through the Express app.
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      // Mirror Cloudflare env bindings (secrets/vars) into process.env so the
      // Express app's existing process.env reads (DATABASE_URL, CLERK_SECRET_KEY,
      // etc.) work without code changes. Bindings are stable per deployment.
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
          process.env[key] = value;
        }
      }
      return expressHandler.fetch(request, env, ctx);
    }

    // Everything else: serve static assets (SPA fallback handled by
    // assets.not_found_handling = "single-page-application" in wrangler.json)
    return env.ASSETS.fetch(request);
  },
};
