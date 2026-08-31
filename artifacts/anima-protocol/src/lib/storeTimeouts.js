/**
 * Fail-fast budget for /api/store so full-screen Loading cannot hang until
 * Postgres or the Worker times out. Keep these in lockstep: fetch abort,
 * auth wait, and bootstrap UI wait all share the same ceiling.
 *
 * ChatSession.create / Init is the exception: one insert after a Worker cold
 * start + Hyperdrive can exceed 8s even when the write is healthy. Do not
 * raise STORE_FETCH_TIMEOUT_MS for that — use STORE_SESSION_CREATE_TIMEOUT_MS
 * only on the create write (see createInitChatSession).
 */
export const STORE_FETCH_TIMEOUT_MS = 8000;
export const STORE_AUTH_WAIT_MS = 8000;
export const BOOTSTRAP_UI_TIMEOUT_MS = 8000;
/** Targeted wall-clock budget for POST /api/store/ChatSession (Init / create). */
export const STORE_SESSION_CREATE_TIMEOUT_MS = 20000;
/** Extra create attempts after the first abort/timeout (Init only). */
export const STORE_SESSION_CREATE_RETRY_LIMIT = 1;
