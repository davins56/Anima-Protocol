import { authHeaders } from "@/api/authBridge";
import { apiUrl } from "@/lib/apiOrigin";
import {
  chatFailureTypeById,
  isChatFailurePhase,
} from "./chatFailureTypes.js";

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const VERSION_RE = /^[A-Za-z0-9._+-]{1,64}$/;
const MAX_MS = 3_600_000;
const MAX_UA = 180;
const MAX_PER_MINUTE = 8;

const NETWORK_RE =
  /failed to fetch|load failed|networkerror|network request failed|network connection|internet connection/i;
const ENGINE_TYPE_ERROR_RE =
  /before initialization|is not defined|is not a function|Cannot read propert|dynamically imported module/i;
const AUTH_RE = /^(?:unauthorized|not signed in)\b|session may have expired/i;
const EMPTY_REPLY_RE = /empty reply/i;
const TIMEOUT_RE = /took too long/i;
const STILL_REPLYING_RE = /still finishing the last reply/i;
const BUSY_RE = /still finishing the last reply|already being processed/i;

/** @type {Set<string>} */
const reportedKeys = new Set();
let windowStarted = 0;
let windowCount = 0;

/** Test helper. */
export function resetChatClientFailureReportsForTests() {
  reportedKeys.clear();
  windowStarted = 0;
  windowCount = 0;
}

/**
 * True when any of the visible pieces already has text. The strings stay
 * here — callers pass only the boolean into the report.
 *
 * @param {{ retained?: unknown, streamed?: unknown, partial?: unknown }} [pieces]
 * @returns {boolean}
 */
export function replyWasKept(pieces = {}) {
  const retained =
    pieces.retained && typeof pieces.retained === "object"
      ? /** @type {{ content?: unknown }} */ (pieces.retained).content
      : pieces.retained;
  return [retained, pieces.streamed, pieces.partial].some(
    (value) => String(value ?? "").trim().length > 0,
  );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanId(value) {
  const text = String(value ?? "").trim();
  return ID_RE.test(text) ? text : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanVersion(value) {
  const text = String(value ?? "").trim();
  return VERSION_RE.test(text) ? text : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanUserAgent(value) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_UA);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function cleanMs(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_MS, Math.max(0, Math.round(n)));
}

/**
 * Build-time commit when the host injected one. Empty in local dev.
 * @returns {string}
 */
export function readAppRevision() {
  try {
    const value = import.meta.env.VITE_APP_COMMIT;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/**
 * @returns {string}
 */
function readUserAgent() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
      return navigator.userAgent;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * @param {unknown} error
 * @returns {{ status: number, code: string, name: string, message: string }}
 */
function errorFacts(error) {
  const row =
    error && typeof error === "object"
      ? /** @type {{ status?: unknown, code?: unknown, name?: unknown, message?: unknown }} */ (
          error
        )
      : {};
  const status = Number(row.status);
  return {
    status: Number.isFinite(status) ? status : 0,
    code: typeof row.code === "string" ? row.code : "",
    name: typeof row.name === "string" ? row.name : "",
    message: typeof row.message === "string" ? row.message : "",
  };
}

/**
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
function traceOf(error) {
  if (!error || typeof error !== "object") return {};
  const trace = /** @type {{ chatClientTrace?: unknown }} */ (error).chatClientTrace;
  return trace && typeof trace === "object" ? /** @type {Record<string, unknown>} */ (trace) : {};
}

/**
 * @param {Record<string, unknown>} trace
 * @param {boolean} partialKept
 * @returns {{ sawFirstToken: boolean, sawQueueWait: boolean, leftQueue: boolean, serverError: boolean }}
 */
function signals(trace, partialKept) {
  const sawFirstToken = trace.sawFirstToken === true || partialKept;
  const sawQueueWait = trace.sawQueueWait === true;
  const leftQueue = trace.leftQueue === true || sawFirstToken;
  return {
    sawFirstToken,
    sawQueueWait,
    leftQueue,
    serverError: trace.serverError === true,
  };
}

/**
 * Where this attempt died, using the #565 phase names.
 *
 * @param {{ sawFirstToken: boolean, sawQueueWait: boolean, leftQueue: boolean }} signal
 * @param {boolean} saveFailed
 * @returns {"queue" | "prefill" | "decode" | "post"}
 */
function observedPhase(signal, saveFailed) {
  if (saveFailed) return "post";
  if (signal.sawFirstToken) return "decode";
  if (signal.sawQueueWait && !signal.leftQueue) return "queue";
  if (signal.leftQueue) return "prefill";
  return "prefill";
}

/**
 * @param {{
 *   error?: unknown,
 *   partialKept?: boolean,
 *   saveFailed?: boolean,
 * }} input
 * @returns {{ id: string, phase: "queue" | "prefill" | "decode" | "post" }}
 */
export function classifyChatClientFailure(input = {}) {
  const facts = errorFacts(input.error);
  const trace = traceOf(input.error);
  const partialKept = input.partialKept === true || trace.partialKept === true;
  const saveFailed = input.saveFailed === true;
  const signal = signals(trace, partialKept);
  const phase = observedPhase(signal, saveFailed);

  if (saveFailed) return { id: "save_failed", phase: "post" };

  if (facts.status === 401 || facts.code === "auth_expired" || AUTH_RE.test(facts.message)) {
    return { id: "auth_expired", phase: "queue" };
  }

  if (EMPTY_REPLY_RE.test(facts.message) && !signal.sawFirstToken) {
    return { id: "post", phase: "post" };
  }

  const network =
    !ENGINE_TYPE_ERROR_RE.test(facts.message) &&
    (facts.name === "NetworkError" ||
      (facts.name === "TypeError" && NETWORK_RE.test(facts.message)));
  if (network) {
    if (signal.sawFirstToken) return { id: "network_lost", phase: "decode" };
    return {
      id: "network_lost",
      phase: signal.sawQueueWait && !signal.leftQueue ? "queue" : "prefill",
    };
  }

  const timeout =
    facts.code === "chat_stream_timeout" ||
    facts.code === "ABORT_ERR" ||
    facts.name === "AbortError" ||
    facts.name === "TimeoutError" ||
    TIMEOUT_RE.test(facts.message);
  if (timeout) {
    if (signal.sawFirstToken) return { id: "stream_dropped", phase: "decode" };
    if (signal.sawQueueWait && !signal.leftQueue) return { id: "queue_timeout", phase: "queue" };
    return { id: "no_first_token", phase: "prefill" };
  }

  if (
    facts.code === "conversation_busy" ||
    facts.code === "turn_in_flight" ||
    facts.status === 409 ||
    BUSY_RE.test(facts.message)
  ) {
    return { id: "queue_waiting", phase: "queue" };
  }

  const server =
    signal.serverError ||
    (facts.status >= 400 && facts.status !== 401) ||
    facts.code === "api_error" ||
    facts.code === "workersai_free_quota_exhausted";
  if (server) {
    if (signal.sawFirstToken) return { id: "stream_dropped", phase: "decode" };
    if (signal.sawQueueWait && !signal.leftQueue) return { id: "server_error", phase: "queue" };
    return { id: "server_error", phase: signal.leftQueue ? "prefill" : "queue" };
  }

  if (signal.sawFirstToken) return { id: "stream_dropped", phase: "decode" };
  if (signal.sawQueueWait && !signal.leftQueue) return { id: "queue_waiting", phase: "queue" };
  if (!signal.sawFirstToken) return { id: "no_first_token", phase };
  return { id: phase, phase };
}

/**
 * A stop, a page leave, or "she's still replying" is not a failed turn.
 * The fetch deadline (`chat_stream_timeout`) still is.
 *
 * @param {{ error?: unknown }} [input]
 * @returns {boolean}
 */
export function isIgnoredChatClientFailure(input = {}) {
  const facts = errorFacts(input.error);
  if (facts.code === "chat_user_cancel") return true;
  if (facts.code === "conversation_busy" || STILL_REPLYING_RE.test(facts.message)) {
    return true;
  }
  const deadline =
    facts.code === "chat_stream_timeout" || TIMEOUT_RE.test(facts.message);
  if (deadline) return false;
  return facts.name === "AbortError" || facts.code === "ABORT_ERR";
}

/**
 * Allowlisted report. Never copies message, reply, or memory text.
 *
 * @param {{
 *   error?: unknown,
 *   sessionId?: unknown,
 *   turnId?: unknown,
 *   partialKept?: boolean,
 *   saveFailed?: boolean,
 *   msToFailure?: unknown,
 *   msToFirstToken?: unknown,
 *   appVersion?: unknown,
 *   userAgent?: unknown,
 * }} input
 * @returns {Record<string, unknown> | null}
 */
export function buildChatClientFailureReport(input = {}) {
  const classified = classifyChatClientFailure(input);
  if (!chatFailureTypeById(classified.id) || !isChatFailurePhase(classified.phase)) {
    return null;
  }
  const sessionId = cleanId(input.sessionId);
  if (!sessionId) return null;
  const turnId = cleanId(input.turnId);
  const trace = traceOf(input.error);
  const startedAt = typeof trace.startedAt === "number" ? trace.startedAt : null;
  const firstTokenAt = typeof trace.firstTokenAt === "number" ? trace.firstTokenAt : null;
  const elapsed =
    input.msToFailure != null
      ? input.msToFailure
      : startedAt == null
        ? 0
        : Date.now() - startedAt;
  const first =
    input.msToFirstToken != null
      ? input.msToFirstToken
      : firstTokenAt == null || startedAt == null
        ? null
        : firstTokenAt - startedAt;
  const partialKept = input.partialKept === true || trace.partialKept === true;
  /** @type {Record<string, unknown>} */
  const report = {
    failure_type: classified.id,
    phase: classified.phase,
    session_id: sessionId,
    ms_to_failure: cleanMs(elapsed) ?? 0,
    ms_to_first_token: first == null ? null : cleanMs(first),
    partial_kept: partialKept,
  };
  if (turnId) report.turn_id = turnId;
  const version = cleanVersion(
    input.appVersion != null ? input.appVersion : readAppRevision(),
  );
  if (version) report.app_version = version;
  const userAgent = cleanUserAgent(
    input.userAgent != null ? input.userAgent : readUserAgent(),
  );
  if (userAgent) report.user_agent = userAgent;
  return report;
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function takeReportSlot(key) {
  if (key && reportedKeys.has(key)) return false;
  const now = Date.now();
  if (now - windowStarted > 60_000) {
    windowStarted = now;
    windowCount = 0;
  }
  if (windowCount >= MAX_PER_MINUTE) return false;
  if (key) {
    reportedKeys.add(key);
    if (reportedKeys.size > 200) {
      const oldest = reportedKeys.values().next().value;
      if (oldest) reportedKeys.delete(oldest);
    }
  }
  windowCount += 1;
  return true;
}

/**
 * @param {Record<string, unknown>} report
 * @param {number} attempt
 * @returns {Promise<void>}
 */
async function postChatClientFailure(report, attempt) {
  const headers = await authHeaders(
    { "Content-Type": "application/json" },
    attempt > 0 ? { skipCache: true } : undefined,
  );
  if (!headers?.Authorization) {
    throw new Error("no auth");
  }
  const res = await fetch(apiUrl("/chat/client-failure"), {
    method: "POST",
    headers,
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify(report),
  });
  if (res.status === 400 || res.status === 401 || res.status === 429) return;
  if (!res.ok) throw new Error("report failed");
}

/**
 * @param {Record<string, unknown>} report
 * @returns {Promise<void>}
 */
async function postChatClientFailureWithRetry(report) {
  let lastError = /** @type {unknown} */ (null);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await postChatClientFailure(report, attempt);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("report failed");
}

/**
 * Awaitable send used by tests. Swallows transport failures.
 *
 * @param {Parameters<typeof buildChatClientFailureReport>[0]} input
 * @returns {Promise<{ sent: boolean, reason?: string, report?: Record<string, unknown> }>}
 */
export async function deliverChatClientFailure(input) {
  if (isIgnoredChatClientFailure(input)) return { sent: false, reason: "ignored" };
  const report = buildChatClientFailureReport(input);
  if (!report) return { sent: false, reason: "invalid" };
  // Dedupe retries of this attempt only. A missing attempt id must not
  // suppress the next failure in the same chat.
  const turnId = typeof report.turn_id === "string" ? report.turn_id : "";
  const key = turnId ? `${turnId}:${report.failure_type}` : "";
  if (!takeReportSlot(key)) return { sent: false, reason: "deduped" };
  try {
    await postChatClientFailureWithRetry(report);
    return { sent: true, report };
  } catch {
    return { sent: false, reason: "transport", report };
  }
}

/**
 * Fire-and-forget. A failed report must not change the chat UI.
 *
 * @param {Parameters<typeof buildChatClientFailureReport>[0]} input
 */
export function reportChatClientFailure(input) {
  try {
    void deliverChatClientFailure(input).catch(() => {});
  } catch {
    /* never into the UI */
  }
}
