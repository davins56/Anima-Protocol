/**
 * Fail-fast budget for /api/store so full-screen Loading cannot hang until
 * Postgres or the Worker times out. Auth wait and the subsequent fetch are
 * separate clocks: wait for a Clerk token first (STORE_AUTH_WAIT_MS), then
 * arm a fresh AbortSignal for the list/write (STORE_FETCH_TIMEOUT_MS).
 * Do not share one 8s signal across both — that is what made a healthy
 * 65–100ms unauth list look like a timeout → bundled OFFLINE roster.
 *
 * Do not raise STORE_FETCH_TIMEOUT_MS / STORE_LIST_TIMEOUT_MS to "fix"
 * that. Unauth lists and healthz/db are well under 1s; the 8s budget is
 * eaten by token wait, not a cold Worker GET.
 *
 * ChatSession.create / Init, TherapyTopic.create, and Character/Anima create
 * are the write exceptions: one insert after a Worker cold start + Hyperdrive
 * can exceed 8s. Use the targeted create budgets below — not a higher list
 * cap. Bundled starter upsert is fail-open so it cannot spend the create
 * budget before the insert.
 */
export const STORE_FETCH_TIMEOUT_MS = 8000;
export const STORE_AUTH_WAIT_MS = 8000;
export const BOOTSTRAP_UI_TIMEOUT_MS = 8000;
/**
 * Clerk `getToken()` has no abort. Cap it below the store/UI budget so
 * `storeFetch` / `auth.me` can still apply AbortSignal.timeout instead of
 * hanging forever before the fetch starts.
 */
export const STORE_TOKEN_TIMEOUT_MS = 4000;
/** Extra list/GET attempts after the first AbortSignal.timeout (queryEntity). */
export const STORE_LIST_RETRY_LIMIT = 1;
/** Targeted wall-clock budget for POST /api/store/ChatSession (Init / create). */
export const STORE_SESSION_CREATE_TIMEOUT_MS = 20000;
/**
 * Character / Anima list after a completed auth wait. Same 8s as other
 * store fetches — unauth lists are 65–100ms. Raising this does not fix a
 * shared auth+fetch abort. storeFetch waits for the token first, then
 * arms a fresh signal with this budget.
 */
export const STORE_LIST_TIMEOUT_MS = STORE_FETCH_TIMEOUT_MS;
/** Extra create attempts after the first abort/timeout (Init only). */
export const STORE_SESSION_CREATE_RETRY_LIMIT = 1;
/** Same 20s budget for POST /api/store/TherapyTopic — do not raise the global 8s cap. */
export const STORE_TOPIC_CREATE_TIMEOUT_MS = STORE_SESSION_CREATE_TIMEOUT_MS;
/** Extra create attempts after the first timeout/503 reset (TherapyTopic). */
export const STORE_TOPIC_CREATE_RETRY_LIMIT = STORE_SESSION_CREATE_RETRY_LIMIT;
/** Same 20s budget for POST /api/store/Character and /Anima (companion create). */
export const STORE_COMPANION_CREATE_TIMEOUT_MS = STORE_SESSION_CREATE_TIMEOUT_MS;
/** Extra create attempts after the first timeout/503 reset (Character / Anima). */
export const STORE_COMPANION_CREATE_RETRY_LIMIT = STORE_SESSION_CREATE_RETRY_LIMIT;

/**
 * Race `promise` against a wall-clock budget. A late resolve is ignored.
 *
 * @template T
 * @param {Promise<T> | T} promise
 * @param {number} timeoutMs
 * @param {(() => Error) | string} [createTimeoutError]
 * @returns {Promise<T>}
 */
export function withStoreTimeout(promise, timeoutMs, createTimeoutError) {
  let timer = 0;
  const pending = Promise.resolve(promise);
  pending.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err =
        typeof createTimeoutError === "function"
          ? createTimeoutError()
          : new Error(
              typeof createTimeoutError === "string" && createTimeoutError
                ? createTimeoutError
                : "The store took too long to respond.",
            );
      if (!err.code) err.code = "timeout";
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([pending, timeout]).finally(() => {
    clearTimeout(timer);
  });
}
