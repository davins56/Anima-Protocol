import { httpServerHandler } from "cloudflare:node";
import app from "./app";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  [key: string]: unknown;
}

// Expose the Express app through Cloudflare's Node.js HTTP adapter so all API
// routes run inside the Worker while the SPA is served by the ASSETS binding.
const expressHandler = httpServerHandler({ app });

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      // Existing server modules read process.env. Mirror string Worker bindings
      // into process.env before dispatching the request to Express.
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
          process.env[key] = value;
        }
      }
      return expressHandler.fetch(request, env, ctx);
    }

    // Cloudflare's asset binding owns all non-API requests, including SPA
    // fallback configured by assets.not_found_handling.
    return env.ASSETS.fetch(request);
  },
};
