import { classifyDbError, isWorkerApiTimeoutError } from "./dbErrors";

/** Store / health probes — return JSON before Cloudflare HTML 524/1101. */
export const WORKER_API_TIMEOUT_MS = 20_000;

/**
 * Live `/api/healthz/llm?probe=1` needs longer than the store wall (cold
 * Ollama generate) but must stay bounded — unbounded probes can pin Worker
 * capacity. Still well under Cloudflare HTML 524.
 */
export const WORKER_LLM_PROBE_TIMEOUT_MS = 45_000;

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

export function isStoreApiPath(pathname: string): boolean {
  return pathname === "/api/store" || pathname.startsWith("/api/store/");
}

/**
 * Long-lived /api streams must not be raced against a wall-clock timeout
 * (SSE store push, chat completions). Store + healthz still time out so a
 * hung Hyperdrive query cannot become Cloudflare HTML.
 *
 * Live LLM probes (`/api/healthz/llm?probe=1`) stay on the healthz timeout
 * path but use a longer budget (`WORKER_LLM_PROBE_TIMEOUT_MS`) so a slow
 * custom host is not cut at 20s and misreported as a database timeout.
 */
export function isLongLivedApiPath(pathname: string): boolean {
  return (
    /\/api\/store\/events(?:\/|$)/.test(pathname) ||
    /\/api\/(?:openai|chat)(?:\/|$)/.test(pathname)
  );
}

/** Live `?probe=1` against the custom LLM. */
export function isLlmHealthProbePath(pathname: string, search = ""): boolean {
  if (!/^\/api\/healthz\/llm\/?$/.test(pathname)) return false;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const probe = new URLSearchParams(raw).get("probe");
  return probe === "1" || probe === "true" || probe === "yes";
}

export function shouldTimeoutApiPath(pathname: string, search = ""): boolean {
  return (
    isWorkerApiPath(pathname) &&
    !isLongLivedApiPath(pathname) &&
    /^\/api\/(?:store|healthz)(?:\/|$)/.test(pathname)
  );
}

/** Wall-clock budget for a timed `/api` path. Probes are longer, not unbounded. */
export function workerApiTimeoutMs(pathname: string, search = ""): number {
  return isLlmHealthProbePath(pathname, search)
    ? WORKER_LLM_PROBE_TIMEOUT_MS
    : WORKER_API_TIMEOUT_MS;
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

export function isHttpRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/** clerk-js and other non-JSON FAPI assets must not be rewritten as JSON errors. */
export function isScriptOrBinaryContentType(
  contentType: string | null | undefined,
): boolean {
  const value = String(contentType || "").toLowerCase();
  return (
    value.includes("javascript") ||
    value.includes("ecmascript") ||
    value.includes("wasm") ||
    value.startsWith("image/") ||
    value.startsWith("font/") ||
    value.includes("octet-stream")
  );
}

export function looksLikeHtmlBody(text: string): boolean {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const head = raw.trimStart().slice(0, 400);
  return (
    /<!DOCTYPE\s+html/i.test(head) ||
    /^<html[\s>]/i.test(head) ||
    /<!--\[if\s+lt\s+IE/i.test(head) ||
    /<center>\s*cloudflare\s*<\/center>/i.test(raw) ||
    /301\s+Moved\s+Permanently/i.test(head)
  );
}

export function jsonApiErrorResponse(
  err: unknown,
  status = 503,
  pathname = "",
): Response {
  if (isWorkerApiTimeoutError(err) || err instanceof WorkerApiTimeoutError) {
    const llmProbe = /^\/api\/healthz\/llm\/?$/.test(pathname);
    return new Response(
      JSON.stringify({
        error: llmProbe
          ? "LLM health probe timed out"
          : "The API request timed out.",
        dbError: false,
        reason: "timeout",
        code: "timeout",
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

  const dbInfo = classifyDbError(err);
  const store = isStoreApiPath(pathname);
  const treatAsDb = dbInfo.isDbError || store;
  const payload = treatAsDb
    ? {
        error: dbInfo.isDbError
          ? dbInfo.safeMessage
          : "The companion store is unreachable.",
        dbError: dbInfo.isDbError,
        reason: dbInfo.isDbError ? dbInfo.reason : "unavailable",
        code: dbInfo.code ?? (store ? "store_unavailable" : "database_unavailable"),
      }
    : {
        error: "The API is temporarily unavailable. Retry in a moment.",
        dbError: false,
        reason: "unavailable" as const,
        code: "worker_api_failure",
      };
  return new Response(JSON.stringify(payload), {
    status: treatAsDb ? 503 : status,
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
  pathname = "",
): Promise<Response> {
  const contentType = response.headers.get("content-type");
  if (isStreamingContentType(contentType)) return response;
  if (isJsonContentType(contentType)) return response;
  // Clerk npm version hops and OAuth Location must keep their status + Location.
  // Swallowing a 307 as JSON (`worker_api_failure`) drops Location; browsers
  // then refuse clerk.browser.js as a script (classic "failed to load (307)").
  if (isHttpRedirectStatus(response.status)) return response;
  if (isScriptOrBinaryContentType(contentType)) return response;
  if (response.ok) return response;

  if (isHtmlContentType(contentType)) {
    return jsonApiErrorResponse(
      new Error("Upstream returned an HTML error page"),
      response.status >= 500 ? 503 : response.status || 503,
      pathname,
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
      pathname,
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
  const url = new URL(request.url);
  const pathname = url.pathname;
  try {
    const pending = handler.fetch(request, env, ctx);
    const response = shouldTimeoutApiPath(pathname, url.search)
      ? await withWorkerApiTimeout(
          pending,
          options.timeoutMs ?? workerApiTimeoutMs(pathname, url.search),
        )
      : await pending;
    return await coerceApiResponseToJson(response, pathname);
  } catch (err) {
    return jsonApiErrorResponse(err, 503, pathname);
  }
}
