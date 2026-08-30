import "./lib/cloudflareEnvBootstrap";
import { httpServerHandler } from "cloudflare:node";
import { env as importableWorkerEnv } from "cloudflare:workers";
import app from "./app";
import {
  applyCloudflareRequestEnv,
  bindImportableEnv,
} from "./lib/cloudflareEnv";
import { fetchAssetsRejectingSpaHtml } from "./lib/spaAssetFallback";
import {
  fetchApiThroughExpress,
  isWorkerApiPath,
  jsonApiErrorResponse,
} from "./lib/workerApiGuard";
import { apexRedirectForWww } from "./lib/wwwHostRedirect";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Present only when a Hyperdrive config is bound in the dashboard. */
  HYPERDRIVE?: { connectionString?: string };
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

    // www must keep pathname + query. A host-only 301 to the apex homepage
    // made fetch("/api/store/Character") parse homepage HTML as a store error.
    const wwwRedirect = apexRedirectForWww(request);
    if (wwwRedirect) return wwwRedirect;

    // Route /api/* requests through the Express app. Isolate throws, hung
    // Hyperdrive queries, and HTML error pages are coerced to JSON 503/500 so
    // the Character library never renders Cloudflare's IE-conditional page.
    if (isWorkerApiPath(url.pathname)) {
      // Request-time apply: fetch env + importable env, including non-enumerable
      // secrets and Secrets Store-style objects. Do not rely on a boot snapshot
      // of process.env — httpServerHandler may reset it after this returns.
      try {
        await applyCloudflareRequestEnv(env);
        return await fetchApiThroughExpress(request, env, ctx, expressHandler);
      } catch (err) {
        return jsonApiErrorResponse(err);
      }
    }

    // Static assets + client routes. SPA fallback for extensionless routes is
    // handled by assets.not_found_handling = "single-page-application".
    // /api and /assets are run_worker_first so Express and this HTML→404 guard
    // see those paths (including stale EchoKeys-*.js hashes) before Assets can
    // swallow them as index.html.
    return fetchAssetsRejectingSpaHtml(request, env.ASSETS);
  },
};
