/// <reference lib="dom" />

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
import { setAiBinding } from "./lib/aiBinding";

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

    const wwwRedirect = apexRedirectForWww(request);
    if (wwwRedirect) return wwwRedirect;

    if (isWorkerApiPath(url.pathname)) {
      setAiBinding(env.AI);
      try {
        await applyCloudflareRequestEnv(env);
        return await fetchApiThroughExpress(request, env, ctx, expressHandler);
      } catch (err) {
        return jsonApiErrorResponse(err, 503, url.pathname);
      }
    }

    return fetchAssetsRejectingSpaHtml(request, env.ASSETS);
  },
};
