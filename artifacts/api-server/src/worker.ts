/// <reference lib="dom" />

import "./lib/cloudflareEnvBootstrap";
import { httpServerHandler } from "cloudflare:node";
import { env as importableWorkerEnv } from "cloudflare:workers";
import app from "./app";
import {
  applyCloudflareRequestEnv,
  bindImportableEnv,
} from "./lib/cloudflareEnv";
import { handleClerkCnameGateway, isClerkCnameRequestHost } from "./lib/clerkCnameGateway";
import { fetchAssetsRejectingSpaHtml } from "./lib/spaAssetFallback";
import {
  fetchApiThroughExpress,
  isWorkerApiPath,
  jsonApiErrorResponse,
} from "./lib/workerApiGuard";
import { apexRedirectForWww } from "./lib/wwwHostRedirect";
import { setAiBinding } from "./lib/aiBinding";
import {
  clearWorkerWaitUntil,
  registerWorkerWaitUntil,
} from "./lib/workerBackground";

export { LocalLlmSlot } from "./lib/localLlmSlotDo";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  HYPERDRIVE?: { connectionString?: string };
  AI?: { run: (model: string, options: Record<string, unknown>) => Promise<unknown> };
  [key: string]: unknown;
}

bindImportableEnv(importableWorkerEnv);

const WORKER_API_PORT = 8080;
app.listen(WORKER_API_PORT);

const expressHandler = httpServerHandler({ port: WORKER_API_PORT });

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // GitHub's document callback is clerk.{apex}. That hostname is a
    // CNAME to Clerk (Safari ITP cloaking). Terminate it here so we can
    // inject Domain=apex `__client` and never render 403 JSON.
    if (isClerkCnameRequestHost(url.hostname)) {
      // Secrets Store bindings are needed for Clerk-Secret-Key on the
      // rewritten frontend-api.clerk.dev hop. Mirror them before the
      // gateway runs (this path returns before Express).
      try {
        await applyCloudflareRequestEnv(env);
      } catch {
        // Still gateway; environment may be host_invalid without the secret.
      }
      return handleClerkCnameGateway(request);
    }

    const wwwRedirect = apexRedirectForWww(request);
    if (wwwRedirect) return wwwRedirect;

    if (isWorkerApiPath(url.pathname)) {
      setAiBinding(env.AI);
      const backgroundToken = crypto.randomUUID();
      registerWorkerWaitUntil(backgroundToken, (promise) => ctx.waitUntil(promise));
      const headers = new Headers(request.headers);
      headers.set("x-anima-bg", backgroundToken);
      const forwarded = new Request(request, { headers });
      try {
        await applyCloudflareRequestEnv(env);
        return await fetchApiThroughExpress(forwarded, env, ctx, expressHandler);
      } catch (err) {
        return jsonApiErrorResponse(err, 503, url.pathname);
      } finally {
        clearWorkerWaitUntil(backgroundToken);
      }
    }

    return fetchAssetsRejectingSpaHtml(request, env.ASSETS);
  },
};
