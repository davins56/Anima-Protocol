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
