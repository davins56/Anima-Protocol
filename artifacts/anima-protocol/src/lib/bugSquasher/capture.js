// @ts-check
/**
 * Bug Squasher capture: turns crashes, unhandled errors, failed API calls and
 * failed chat turns into deduped, rate-limited, scrubbed reports for
 * POST /api/bug-squasher/reports.
 *
 * Nothing is sent until installBugSquasher() runs (BugSquasherSync mounts it
 * once the app shell is up), so unit tests and the public Landing page never
 * post. Every entry point is best-effort and never throws into the caller.
 *
 * Dedupe: one fingerprint is sent at most once per DEDUPE_WINDOW_MS; repeats
 * inside the window are counted and sent as `occurrences` on the next send.
 * Rate limit: MAX_PER_MINUTE sends a minute, MAX_PER_SESSION per page load.
 * The server answers 503 before its migration exists, 401 when signed out:
 * either pauses sending instead of retrying in a loop.
 */
import { authHeaders } from "@/api/authBridge";
import { apiUrl } from "@/lib/apiOrigin";
import { localFingerprint, normalizeApiPath } from "./fingerprint.js";
import { scrubText, scrubUrlPath, scrubValue } from "./scrub.js";

export const BREADCRUMB_LIMIT = 30;
export const DEDUPE_WINDOW_MS = 60_000;
export const MAX_PER_MINUTE = 10;
export const MAX_PER_SESSION = 60;
const FLUSH_DELAY_MS = 1_500;
const PAUSE_UNAVAILABLE_MS = 10 * 60_000;
const PAUSE_RATE_LIMITED_MS = 60_000;
const MAX_PENDING = 20;
const REPORT_PATH = "/bug-squasher/reports";

/** Paths whose failures are not reported (our own, auth plumbing, probes). */
const IGNORED_API_PATHS = [
  "/api/bug-squasher",
  "/api/chat/client-failure",
  "/api/__clerk",
  "/api/healthz",
  "/api/csp-report",
];

/** Noise every app sees and nobody can fix. */
const IGNORED_MESSAGES = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
  /^Script error\.?$/i,
  /^(?:AbortError|The (?:operation|user) (?:was )?abort(?:ed)?)/i,
  /Non-Error promise rejection captured with value: (?:undefined|null)/i,
];
const EXTENSION_STACK_RE = /(?:chrome|moz|safari(?:-web)?)-extension:\/\//i;

/**
 * @typedef {{ at: string, type: string, message: string }} Breadcrumb
 * @typedef {{ kind: string, message?: string, stack?: string, title?: string, route?: string,
 *   context?: Record<string, unknown>, description?: string, screenshot?: string | null }} BugPayload
 * @typedef {{ payload: BugPayload, fp: string, occurrences: number }} PendingReport
 * @typedef {(body: Record<string, unknown>) => Promise<{ status: number }>} SendFn
 */

const state = {
  installed: false,
  /** @type {Breadcrumb[]} */
  breadcrumbs: [],
  /** @type {Map<string, PendingReport>} */
  pending: new Map(),
  /** @type {Map<string, number>} fingerprint → last send time */
  lastSent: new Map(),
  /** @type {number[]} */
  sendTimes: [],
  sessionSends: 0,
  pausedUntil: 0,
  /** @type {ReturnType<typeof setTimeout> | null} */
  flushTimer: null,
  /** @type {SendFn | null} */
  send: null,
  /** @type {() => string | null} */
  getUserId: () => null,
  /** @type {Array<{ at: string, kind: string, title: string }>} */
  recentErrors: [],
  now: () => Date.now(),
};

/** Test helper: forget everything. */
export function resetBugSquasherForTests() {
  if (state.flushTimer) clearTimeout(state.flushTimer);
  state.installed = false;
  state.breadcrumbs = [];
  state.pending.clear();
  state.lastSent.clear();
  state.sendTimes = [];
  state.sessionSends = 0;
  state.pausedUntil = 0;
  state.flushTimer = null;
  state.send = null;
  state.getUserId = () => null;
  state.recentErrors = [];
  state.now = () => Date.now();
}

/** @returns {boolean} */
export function isBugSquasherInstalled() {
  return state.installed;
}

/**
 * Build-time commit when the host injected one.
 * @returns {string}
 */
export function readAppVersion() {
  try {
    const value = import.meta.env.VITE_APP_COMMIT;
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : "dev";
  } catch {
    return "dev";
  }
}

/** @returns {string} */
function currentRoute() {
  try {
    return scrubUrlPath(`${window.location.pathname}${window.location.search}`);
  } catch {
    return "";
  }
}

/**
 * Remember what just happened (navigation, API call, error, chat). Kept in a
 * small ring and attached to the next report.
 * @param {string} type
 * @param {unknown} message
 */
export function recordBreadcrumb(type, message) {
  try {
    state.breadcrumbs.push({
      at: new Date(state.now()).toISOString(),
      type: scrubText(type, 20),
      message: scrubText(message, 200),
    });
    if (state.breadcrumbs.length > BREADCRUMB_LIMIT) {
      state.breadcrumbs.splice(0, state.breadcrumbs.length - BREADCRUMB_LIMIT);
    }
  } catch {
    /* never into the caller */
  }
}

/** @returns {Breadcrumb[]} */
export function getBreadcrumbs() {
  return state.breadcrumbs.slice();
}

/** @returns {Array<{ at: string, kind: string, title: string }>} */
export function getRecentErrors() {
  return state.recentErrors.slice();
}

/**
 * Route, version, browser and recent activity — what a triager needs, never
 * message or memory text.
 * @returns {Record<string, unknown>}
 */
export function buildDiagnosticContext() {
  /** @type {Record<string, unknown>} */
  const ctx = {
    route: currentRoute(),
    app_version: readAppVersion(),
    captured_at: new Date(state.now()).toISOString(),
    breadcrumbs: getBreadcrumbs(),
    recent_errors: getRecentErrors(),
  };
  try {
    const userId = state.getUserId();
    if (userId) ctx.user_id = scrubText(userId, 80);
  } catch {
    /* optional */
  }
  try {
    ctx.browser = {
      language: navigator.language,
      online: navigator.onLine,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      pixel_ratio: window.devicePixelRatio,
      standalone: Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches),
    };
  } catch {
    /* non-browser */
  }
  return ctx;
}

/** @param {unknown} error */
function errorParts(error) {
  if (error && typeof error === "object") {
    const e = /** @type {{ name?: unknown, message?: unknown, stack?: unknown, code?: unknown }} */ (error);
    const name = typeof e.name === "string" ? e.name : "";
    const message = typeof e.message === "string" ? e.message : "";
    return {
      message: message ? (name && !message.startsWith(name) ? `${name}: ${message}` : message) : String(error),
      stack: typeof e.stack === "string" ? e.stack : "",
      name,
      code: typeof e.code === "string" ? e.code : "",
    };
  }
  return { message: error == null ? "" : String(error), stack: "", name: "", code: "" };
}

/**
 * @param {string} message
 * @param {string} stack
 * @returns {boolean}
 */
export function isIgnoredError(message, stack = "") {
  if (!message && !stack) return true;
  if (IGNORED_MESSAGES.some((re) => re.test(message))) return true;
  return EXTENSION_STACK_RE.test(stack);
}

function pruneSendTimes() {
  const cutoff = state.now() - 60_000;
  state.sendTimes = state.sendTimes.filter((t) => t > cutoff);
}

function scheduleFlush(delay = FLUSH_DELAY_MS) {
  if (!state.installed || state.flushTimer) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    void flushBugReports();
  }, delay);
}

/**
 * Queue one report. Returns false when it was dropped (noise, not installed,
 * paused, or the queue is full).
 * @param {BugPayload} payload
 * @param {{ manual?: boolean }} [opts]
 * @returns {boolean}
 */
export function enqueueBugReport(payload, opts = {}) {
  try {
    if (!state.installed && !opts.manual) return false;
    const fp = localFingerprint({
      kind: payload.kind,
      message: payload.message,
      stack: payload.stack,
      description: payload.description,
      api: /** @type {any} */ (payload.context?.api) || null,
      chat: /** @type {any} */ (payload.context?.chat) || null,
    });
    state.recentErrors.push({
      at: new Date(state.now()).toISOString(),
      kind: payload.kind,
      title: scrubText(payload.title || payload.message || payload.kind, 120),
    });
    if (state.recentErrors.length > 10) state.recentErrors.splice(0, state.recentErrors.length - 10);
    const existing = state.pending.get(fp);
    if (existing) {
      existing.occurrences = Math.min(50, existing.occurrences + 1);
      existing.payload = payload;
    } else {
      if (state.pending.size >= MAX_PENDING) return false;
      state.pending.set(fp, { payload, fp, occurrences: 1 });
    }
    scheduleFlush();
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} kind
 * @param {unknown} error
 * @param {{ componentStack?: string, extra?: Record<string, unknown> }} [opts]
 * @returns {boolean}
 */
export function captureError(kind, error, opts = {}) {
  try {
    const parts = errorParts(error);
    if (isIgnoredError(parts.message, parts.stack)) return false;
    recordBreadcrumb("error", `${kind}: ${parts.message}`);
    /** @type {Record<string, unknown>} */
    const context = { ...buildDiagnosticContext(), ...(opts.extra || {}) };
    if (opts.componentStack) context.component_stack = scrubText(opts.componentStack, 1500);
    if (parts.code) context.error_code = parts.code;
    return enqueueBugReport({
      kind,
      message: scrubText(parts.message, 2000),
      stack: scrubText(parts.stack, 8000),
      route: currentRoute(),
      context: /** @type {Record<string, unknown>} */ (scrubValue(context)),
    });
  } catch {
    return false;
  }
}

/**
 * A React error boundary caught a render crash.
 * @param {unknown} error
 * @param {{ componentStack?: string } | null | undefined} errorInfo
 */
export function captureReactCrash(error, errorInfo) {
  return captureError("react_crash", error, { componentStack: errorInfo?.componentStack || "" });
}

/**
 * @param {{ method?: string, url?: string, status?: number, durationMs?: number, error?: unknown }} input
 * @returns {boolean}
 */
export function captureApiFailure(input) {
  try {
    const method = String(input.method || "GET").toUpperCase();
    const path = scrubUrlPath(input.url || "").split("?")[0] || "";
    const status = Number(input.status) || 0;
    const parts = errorParts(input.error);
    const label = `${method} ${normalizeApiPath(path)} → ${status || "network error"}`;
    recordBreadcrumb("api", label);
    return enqueueBugReport({
      kind: "api_error",
      title: label,
      message: scrubText(status ? `HTTP ${status} from ${method} ${path}` : parts.message || "Network request failed", 2000),
      route: currentRoute(),
      context: /** @type {Record<string, unknown>} */ (
        scrubValue({
          ...buildDiagnosticContext(),
          api: { method, path, status, duration_ms: Math.round(Number(input.durationMs) || 0) },
        })
      ),
    });
  } catch {
    return false;
  }
}

/**
 * A chat turn failed or came back empty (called from lib/chatClientFailure.js
 * with its classification; never message or reply text).
 * @param {{ failureType: string, phase: string, message?: string, code?: string, sessionId?: unknown,
 *   turnId?: unknown, partialKept?: boolean, msToFailure?: unknown }} input
 * @returns {boolean}
 */
export function captureChatFailure(input) {
  try {
    const chat = {
      failure_type: scrubText(input.failureType, 40) || "unknown",
      phase: scrubText(input.phase, 20) || "unknown",
      code: scrubText(input.code || "", 60) || null,
      session_id: scrubText(input.sessionId ?? "", 80) || null,
      turn_id: scrubText(input.turnId ?? "", 80) || null,
      partial_kept: input.partialKept === true,
      ms_to_failure: Number.isFinite(Number(input.msToFailure)) ? Math.round(Number(input.msToFailure)) : null,
    };
    recordBreadcrumb("chat", `turn failed: ${chat.failure_type} (${chat.phase})`);
    return enqueueBugReport({
      kind: "chat_failure",
      title: `Chat turn failed: ${chat.failure_type} (${chat.phase})`,
      // The error message is product copy ("The companion returned an empty
      // reply…"), not conversation text; still scrubbed and capped.
      message: scrubText(input.message || `Chat turn failed: ${chat.failure_type}`, 500),
      route: currentRoute(),
      context: /** @type {Record<string, unknown>} */ (scrubValue({ ...buildDiagnosticContext(), chat })),
    });
  } catch {
    return false;
  }
}

/** @param {Record<string, unknown>} body */
async function defaultSend(body) {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  if (!headers?.Authorization) return { status: 401 };
  const json = JSON.stringify(body);
  const doFetch = originalFetch || fetch;
  const res = await doFetch(apiUrl(REPORT_PATH), {
    method: "POST",
    headers,
    credentials: "same-origin",
    keepalive: json.length < 60_000,
    body: json,
  });
  return { status: res.status };
}

/**
 * Send what is due. Respects pause, dedupe window and rate limits; anything
 * not yet due stays queued and a later flush is scheduled.
 * @returns {Promise<number>} reports sent
 */
export async function flushBugReports() {
  if (!state.pending.size) return 0;
  const now = state.now();
  if (now < state.pausedUntil) {
    scheduleFlush(state.pausedUntil - now + 50);
    return 0;
  }
  const send = state.send || defaultSend;
  let sent = 0;
  let nextDue = Infinity;
  for (const [fp, item] of [...state.pending]) {
    pruneSendTimes();
    if (state.sessionSends >= MAX_PER_SESSION) {
      state.pending.clear();
      break;
    }
    if (state.sendTimes.length >= MAX_PER_MINUTE) {
      nextDue = Math.min(nextDue, (state.sendTimes[0] ?? now) + 60_000);
      break;
    }
    const last = state.lastSent.get(fp);
    if (last != null && state.now() - last < DEDUPE_WINDOW_MS) {
      nextDue = Math.min(nextDue, last + DEDUPE_WINDOW_MS);
      continue;
    }
    state.pending.delete(fp);
    state.lastSent.set(fp, state.now());
    state.sendTimes.push(state.now());
    state.sessionSends += 1;
    const body = {
      ...item.payload,
      app_version: readAppVersion(),
      user_agent: scrubText(typeof navigator !== "undefined" ? navigator.userAgent : "", 300),
      occurrences: item.occurrences,
    };
    try {
      const { status } = await send(body);
      if (status === 401 || status === 403 || status === 503 || status === 404) {
        state.pausedUntil = state.now() + PAUSE_UNAVAILABLE_MS;
        break;
      }
      if (status === 429) {
        state.pausedUntil = state.now() + PAUSE_RATE_LIMITED_MS;
        break;
      }
      if (status >= 200 && status < 300) sent += 1;
    } catch {
      // Offline or blocked: let the next error try again later.
      state.pausedUntil = state.now() + PAUSE_RATE_LIMITED_MS;
      break;
    }
  }
  if (state.pending.size) {
    const delay = Number.isFinite(nextDue) ? Math.max(250, nextDue - state.now()) : FLUSH_DELAY_MS;
    scheduleFlush(Math.max(delay, state.pausedUntil - state.now()));
  }
  return sent;
}

/** @type {typeof fetch | null} */
let originalFetch = null;

/**
 * @param {unknown} input
 * @param {RequestInit | undefined} init
 */
function describeRequest(input, init) {
  try {
    if (typeof input === "string") return { url: input, method: init?.method || "GET" };
    if (input instanceof URL) return { url: input.href, method: init?.method || "GET" };
    if (input && typeof input === "object" && "url" in input) {
      const req = /** @type {Request} */ (input);
      return { url: req.url, method: init?.method || req.method || "GET" };
    }
  } catch {
    /* fall through */
  }
  return { url: "", method: "GET" };
}

/**
 * Same-origin (or VITE_API_ORIGIN) `/api/*` path for a request URL, or "".
 * @param {string} url
 * @returns {string}
 */
export function apiPathOf(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    let configured = "";
    try {
      configured = String(import.meta.env.VITE_API_ORIGIN || "").trim();
    } catch {
      configured = "";
    }
    const origins = [window.location.origin];
    if (configured) origins.push(new URL(configured).origin);
    if (!origins.includes(parsed.origin)) return "";
    if (!parsed.pathname.startsWith("/api/")) return "";
    if (IGNORED_API_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`))) return "";
    return parsed.pathname;
  } catch {
    return "";
  }
}

function instrumentFetch() {
  if (typeof window === "undefined" || typeof window.fetch !== "function" || originalFetch) return;
  originalFetch = window.fetch;
  const base = originalFetch;
  /** @type {typeof fetch} */
  const wrapped = function bugSquasherFetch(input, init) {
    // Always call the native fetch on window ("Illegal invocation" otherwise).
    const result = base.call(window, input, init);
    try {
      const { url, method } = describeRequest(input, init);
      const path = apiPathOf(url);
      if (!path) return result;
      const started = state.now();
      const verb = String(method).toUpperCase();
      result.then(
        (res) => {
          recordBreadcrumb("api", `${verb} ${normalizeApiPath(path)} ${res.status}`);
          if (res.status >= 500) {
            captureApiFailure({ method: verb, url: path, status: res.status, durationMs: state.now() - started });
          }
        },
        (err) => {
          const name = err && typeof err === "object" ? /** @type {any} */ (err).name : "";
          if (name === "AbortError" || name === "TimeoutError") {
            recordBreadcrumb("api", `${verb} ${normalizeApiPath(path)} aborted`);
            return;
          }
          captureApiFailure({ method: verb, url: path, status: 0, durationMs: state.now() - started, error: err });
        },
      );
    } catch {
      /* instrumentation never changes the request */
    }
    return result;
  };
  window.fetch = wrapped;
}

function restoreFetch() {
  if (originalFetch && typeof window !== "undefined") window.fetch = originalFetch;
  originalFetch = null;
}

/**
 * Start capturing. Idempotent; returns an uninstall function.
 * @param {{ getUserId?: () => string | null, send?: SendFn, instrumentFetch?: boolean, now?: () => number }} [options]
 * @returns {() => void}
 */
export function installBugSquasher(options = {}) {
  if (options.getUserId) state.getUserId = options.getUserId;
  if (options.send) state.send = options.send;
  if (options.now) state.now = options.now;
  if (state.installed) return () => {};
  state.installed = true;

  /** @param {ErrorEvent} event */
  const onError = (event) => {
    // Resource load errors (img/script 404) bubble here without an error object.
    if (!event?.error && !event?.message) return;
    captureError("window_error", event.error || event.message);
  };
  /** @param {PromiseRejectionEvent} event */
  const onRejection = (event) => {
    captureError("unhandled_rejection", event?.reason);
  };
  const onPageHide = () => {
    void flushBugReports();
  };

  try {
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("pagehide", onPageHide);
  } catch {
    /* non-browser */
  }
  if (options.instrumentFetch !== false) instrumentFetch();
  if (state.pending.size) scheduleFlush();

  return () => {
    try {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("pagehide", onPageHide);
    } catch {
      /* non-browser */
    }
    restoreFetch();
    state.installed = false;
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
  };
}
