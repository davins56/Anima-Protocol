// Single source of truth for deciding *why* an /api/store call failed.
//
// The API already classifies this server-side (api-server/src/lib/dbErrors.ts,
// DbErrorReason) and returns it on the error body as `dbError` + `reason`.
// Preferring that structured signal over prose keeps the UI honest.
//
// Two separate questions were previously answered by one function, which is
// what produced the false "database is unreachable" banners:
//
//   1. Was the database at fault?  -> isStoreDatabaseError()  (drives wording)
//   2. Could we read the account?  -> isStoreReadUnavailable() (drives the
//      bundled-roster fallback, which should happen for *any* read failure)
//
// The old rule was `status === 503 || /database|postgres|unavailable|
// unreachable|connection/i.test(message)`. Both halves over-matched: the API
// returns 503 for non-database store failures too, and the generic timeout
// copy ("Check your connection…") contains the word "connection".

/**
 * `reason` values from the API's DbErrorReason union that mean Postgres itself
 * failed. "internal" is deliberately excluded — classifyDbError() returns it
 * precisely when isDbError is false.
 */
export const DATABASE_ERROR_REASONS = Object.freeze([
  "auth",
  "limit",
  "refused",
  "reset",
  "schema",
  "ssl",
  "timeout",
  "unavailable",
  "unreachable",
]);

const DATABASE_REASON_SET = new Set(DATABASE_ERROR_REASONS);

/**
 * Failures the client generated itself. None of these tell us anything about
 * the database: the request never got a classified answer back.
 */
const CLIENT_FAULT_CODES = new Set(["timeout", "offline", "aborted", "transport"]);

/**
 * Fallback for responses with no structured reason (older API builds, or an
 * edge error page that never reached Express). Deliberately narrow — it must
 * not match "connection" or "unavailable" on their own.
 */
const DATABASE_TEXT = /\b(?:database|postgres(?:ql)?)\b/i;

function normalise(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * True only when the database itself is the cause.
 *
 * Use this to choose wording. Do not use it to decide whether to fall back to
 * the bundled roster — see isStoreReadUnavailable().
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isStoreDatabaseError(err) {
  if (!err || typeof err !== "object") return false;

  // 1. Explicit server verdict wins outright.
  if (typeof err.dbError === "boolean") return err.dbError;

  // 2. Structured reason from the API.
  const reason = normalise(err.reason);
  if (reason) return DATABASE_REASON_SET.has(reason);

  // 3. We failed before the server answered — never a database verdict.
  if (err.transport === true) return false;
  if (CLIENT_FAULT_CODES.has(normalise(err.code))) return false;

  // 4. Legacy prose fallback.
  return DATABASE_TEXT.test(String(err.message || ""));
}

/**
 * True when the account roster could not be read for any reason, so the UI
 * should show the bundled starter roster rather than an empty library.
 *
 * Broader than isStoreDatabaseError on purpose: a Cloudflare edge page, a
 * timeout, or a bug in a store route all leave the user equally unable to
 * read their characters.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isStoreReadUnavailable(err) {
  if (!err || typeof err !== "object") return false;
  if (isStoreDatabaseError(err)) return true;
  if (err.transport === true) return true;
  if (CLIENT_FAULT_CODES.has(normalise(err.code))) return true;

  const status = Number(err.status);
  // 5xx means the server could not answer. 401/403 are deliberately excluded:
  // those need a sign-in prompt, not a fake roster.
  return Number.isFinite(status) && status >= 500;
}

/**
 * Writes that should get one extra attempt: client abort/timeout, 503 reset,
 * and transient Hyperdrive connection errors. Auth failures must not retry.
 */
/**
 * Client abort / storeFetch timeout. Distinct from a Hyperdrive/Postgres
 * `reason: "timeout"` which is a database verdict (isStoreDatabaseError).
 */
export function isStoreTimeoutError(err) {
  if (!err || typeof err !== "object") return false;
  if (normalise(err.code) === "timeout") return true;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  // upsertCharacters used to wrap storeFetch timeouts as a plain Error and
  // drop `code`, so Init showed DEFAULT_STORE_TIMEOUT_MESSAGE verbatim.
  return /took too long to respond/i.test(String(err.message || ""));
}

export function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * True network-down, not a store timeout whose copy says "check your connection".
 */
export function isStoreOfflineError(err) {
  if (isBrowserOffline()) return true;
  if (!err || typeof err !== "object") return false;
  if (normalise(err.code) === "offline" || normalise(err.code) === "network") {
    return true;
  }
  return /network request failed|failed to fetch|net::err_/i.test(
    String(err.message || ""),
  );
}

/**
 * Why the Character Library fell back to bundled starters.
 * Timeout + network up must not be labeled OFFLINE.
 */
export function classifyRosterFallback(err) {
  if (isStoreOfflineError(err) || isBrowserOffline()) return "offline";
  if (isStoreTimeoutError(err)) return "timeout";
  if (isStoreDatabaseError(err)) return "database";
  if (err) return "unavailable";
  return null;
}

export function rosterFallbackLabel(count, kind) {
  const n = Number.isFinite(count) ? count : 0;
  if (kind === "timeout") return `${n} bundled starters (sync delayed)`;
  if (kind === "offline") return `${n} bundled starters (offline)`;
  if (kind === "database" || kind === "unavailable") {
    return `${n} bundled starters (unavailable)`;
  }
  return `${n} bundled starters`;
}

export function rosterFallbackMessage(err, kind, bundledCount) {
  const message = err?.message || "Could not load account characters.";
  const n = Number.isFinite(bundledCount) ? bundledCount : 0;
  if (kind === "timeout") {
    return `${message} Showing starter characters (${n}) — the store is still reachable; retry sync. This is not offline.`;
  }
  if (kind === "offline") {
    return `${message} Showing bundled starters (${n}) — you appear to be offline.`;
  }
  if (kind === "database") {
    return `${message} Showing starter characters (${n}) — not saved to your account until the database is reachable.`;
  }
  return `${message} Showing starter characters (${n}) — not saved to your account until the store can be reached again.`;
}

export function isRetryableStoreWriteError(err) {
  if (!err || typeof err !== "object") return false;
  const status = Number(err.status);
  if (status === 401 || status === 403) return false;
  if (CLIENT_FAULT_CODES.has(normalise(err.code))) return true;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  if (normalise(err.reason) === "reset") return true;
  if (status === 503) return true;
  const message = String(err.message || "");
  return /connection reset/i.test(message) || /took too long to respond/i.test(message);
}
