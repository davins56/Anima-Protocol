import { classifyDbError } from "./dbErrors";

/** Store / health probes — return JSON before Cloudflare HTML 524/1101. */
export const WORKER_API_TIMEOUT_MS = 20_000;

export type WorkerFetchHandler = {
  fetch: (
    request: Request,
    env: unknown,
    ctx: unknown,
  ) => Promise<Response>;
};

export class WorkerApiTimeoutError extends Error {
  code = "ETIMEOUT";
  constructor(ms = WORKER_API_TIMEOUT_MS) {
    super(`API request aborted due to timeout after ${ms}ms`);
    this.name = "WorkerApiTimeoutError";
  }
}

export function isWorkerApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Long-lived /api streams must not be raced against a wall-clock timeout
 * (SSE store push, chat completions). Store + healthz still time out so a
 * hung Hyperdrive query cannot become Cloudflare HTML.
 */
export function isLongLivedApiPath(pathname: string): boolean {
  return (
    /\/api\/store\/events(?:\/|$)/.test(pathname) ||
    /\/api\/(?:openai|chat)(?:\/|$)/.test(pathname)
  );
}

export function shouldTimeoutApiPath(pathname: string): boolean {
  return (
    isWorkerApiPath(pathname) &&
    !isLongLivedApiPath(pathname) &&
    /^\/api\/(?:store|healthz)(?:\/|$)/.test(pathname)
  );
}

export function isJsonContentType(contentType: string | null | undefined): boolean {
  return String(contentType || "")
    .toLowerCase()
    .includes("application/json");
}

export function isHtmlContentType(contentType: string | null | undefined): boolean {
  return String(contentType || "")
    .toLowerCase()
    .includes("text/html");
}

export function isStreamingContentType(
  contentType: string | null | undefined,
): boolean {
  const value = String(contentType || "").toLowerCase();
  return (
    value.includes("text/event-stream") ||
    value.includes("ndjson") ||
    value.includes("octet-stream")
  );
}

export function looksLikeHtmlBody(text: string): boolean {
  const head = String(text || "")
    .replace(/^\uFEFF/, "")
    .trimStart()
    .slice(0, 240);
  return (
    /<!DOCTYPE\s+html/i.test(head) ||
    /^<html[\s>]/i.test(head) ||
    /<!--\[if\s+lt\s+IE/i.test(head)
  );
}

export function jsonApiErrorResponse(
  err: unknown,
  status = 503,
): Response {
  const dbInfo = classifyDbError(err);
  const payload = dbInfo.isDbError
    ? {
        error: dbInfo.safeMessage,
        reason: dbInfo.reason,
        code: dbInfo.code ?? "database_unavailable",
      }
    : {
        error: "The API is temporarily unavailable. Retry in a moment.",
        reason: "unavailable" as const,
        code:
          err instanceof WorkerApiTimeoutError
            ? "timeout"
            : "worker_api_failure",
      };
  return new Response(JSON.stringify(payload), {
    status: dbInfo.isDbError ? 503 : status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * /api/* must never return HTML (Cloudflare 1101/524, Express default 404,
 * SPA fallback). Streaming and successful binary/JSON bodies pass through.
 */
export async function coerceApiResponseToJson(
  response: Response,
): Promise<Response> {
  const contentType = response.headers.get("content-type");
  if (isStreamingContentType(contentType)) return response;
  if (isJsonContentType(contentType)) return response;
  if (response.ok) return response;

  if (isHtmlContentType(contentType)) {
    return jsonApiErrorResponse(
      new Error("Upstream returned an HTML error page"),
      response.status >= 500 ? 503 : response.status || 503,
    );
  }

  let text = "";
  try {
    text = await response.clone().text();
  } catch {
    text = "";
  }
  if (looksLikeHtmlBody(text) || !text.trim().startsWith("{")) {
    return jsonApiErrorResponse(
      new Error("Upstream returned a non-JSON error"),
      response.status >= 500 ? 503 : response.status || 503,
    );
  }
  return response;
}

export async function withWorkerApiTimeout<T>(
  promise: Promise<T>,
  ms = WORKER_API_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkerApiTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run Express through cloudflare:node and guarantee a JSON body when the
 * isolate throws, times out, or Express/CF returns HTML.
 */
export async function fetchApiThroughExpress(
  request: Request,
  env: unknown,
  ctx: unknown,
  handler: WorkerFetchHandler,
  options: { timeoutMs?: number } = {},
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  try {
    const pending = handler.fetch(request, env, ctx);
    const response = shouldTimeoutApiPath(pathname)
      ? await withWorkerApiTimeout(pending, options.timeoutMs)
      : await pending;
    return await coerceApiResponseToJson(response);
  } catch (err) {
    return jsonApiErrorResponse(err);
  }
}
