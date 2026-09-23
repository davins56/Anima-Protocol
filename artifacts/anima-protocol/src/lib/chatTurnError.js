const GENERIC_PROVIDER_RETURNED_RE = /(?:\b\d{3}\s+)?provider returned error/i;
const OPENROUTER_ZDR_DUMP_RE =
  /zdr violation|guardrail restrictions|0 endpoints out of/i;
const GENERIC_HTTP_400_RE =
  /(?:backend\s+request\s+failed|request\s+failed\s+with(?:\s+status\s+code|\s+error)?\s*400|^API\s+error:\s*400$|^HTTP\s*400$|400\s+Bad\s+Request)/i;
const GENERIC_HTTP_STATUS_RE =
  /^(?:API\s+error:\s*\d{3}|HTTP\s*\d{3}|Request\s+failed\s+with\s+status\s+code\s+\d{3})$/i;
const UNAUTHORIZED_RE = /^(?:unauthorized|not signed in)\b/i;
const SESSION_MISSING_RE = /session not found/i;
const WORKERS_AI_RE = /workers ai|deepseek/i;
const WORKERS_AI_4006_RE =
  /\b4006\b|10[, ]?000 neurons|daily free (?:allocation|quota)|used up your daily free/i;
const STORE_UNREACHABLE_RE =
  /companion store is unreachable|server sent an unexpected response/i;
const WORKER_SUBREQUEST_RE =
  /too many subrequests|subrequest limit/i;
const SQL_LEAK_RE =
  /Failed query\b|from\s+"companion_memories"|select\s+"id"\s*,\s*"user_id"|params:\s*user_/i;

const WORKERS_AI_FREE_QUOTA_HINT =
  "Workers AI daily free quota exhausted — enable Workers Paid or temporarily allow OpenRouter failover";

const OPENROUTER_ZDR_PRIVACY_HINT =
  "OpenRouter blocked this model because of your account's Zero Data Retention (ZDR) settings. " +
  "Allow the model (or turn off ZDR) at https://openrouter.ai/settings/privacy.";

/**
 * Map a failed chat turn into copy that is safe to show in the HUD.
 * Engine / bundler errors (TDZ, missing bindings) must not leak minified names.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function chatTurnErrorMessage(err) {
  const raw = err instanceof Error && err.message ? String(err.message).trim() : "";
  const isEngineError =
    err instanceof ReferenceError ||
    err instanceof TypeError ||
    /before initialization|is not defined|is not a function|Cannot read propert/i.test(
      raw,
    );
  if (!raw || isEngineError) {
    return "The companion could not reply. Please try again.";
  }
  // OpenRouter's multi-line ZDR / guardrail dump must never become the toast.
  if (OPENROUTER_ZDR_DUMP_RE.test(raw)) {
    return OPENROUTER_ZDR_PRIVACY_HINT;
  }
  // OpenRouter's opaque GMICloud wrapper must never become the chat toast.
  if (GENERIC_PROVIDER_RETURNED_RE.test(raw)) {
    return (
      "The OpenRouter free-tier model is temporarily unavailable. " +
      "Retry shortly, or add credits at https://openrouter.ai/settings/credits for paid models."
    );
  }
  if (UNAUTHORIZED_RE.test(raw)) {
    return "Not signed in — your session may have expired. Sign out and sign in again, then retry.";
  }
  if (SESSION_MISSING_RE.test(raw)) {
    return "This conversation could not be found. Go back and start the session again.";
  }
  // Drizzle "Failed query" / raw SQL must never become the HUD toast —
  // including when bind params mention "deepseek" / "Workers AI".
  if (SQL_LEAK_RE.test(raw)) {
    return /companion_memories/i.test(raw)
      ? "Couldn't load companion memory. Please try again."
      : "The companion could not reply. Please try again.";
  }
  if (WORKERS_AI_4006_RE.test(raw)) {
    return WORKERS_AI_FREE_QUOTA_HINT;
  }
  if (WORKER_SUBREQUEST_RE.test(raw)) {
    return (
      "The companion could not finish this reply because the chat service is busy. " +
      "Please try again in a moment. Chat does not fall through to OpenRouter or MiniMax."
    );
  }
  if (WORKERS_AI_RE.test(raw)) {
    return raw;
  }
  // HTML/non-JSON store bodies during send must not mask the chat failure.
  if (err?.transport === true || STORE_UNREACHABLE_RE.test(raw)) {
    return "The companion could not reply. Please try again.";
  }
  // Generic 400 / backend request failures must show friendly user copy.
  if (GENERIC_HTTP_400_RE.test(raw)) {
    return "The companion service encountered an issue (HTTP 400). Please try again in a moment.";
  }
  // After Workers AI 4006 the signed-in hop is OpenRouter :free. A bare
  // "API error: 429" / "Request failed with status code 502" must not
  // become the opaque companion-service toast.
  if (GENERIC_HTTP_STATUS_RE.test(raw)) {
    return (
      "The OpenRouter free-tier model is temporarily unavailable. " +
      "Retry shortly, or add credits at https://openrouter.ai/settings/credits for paid models."
    );
  }
  // Local-only timeout / connection copy from `/chat/messages` is already HUD-safe.
  return raw;
}
