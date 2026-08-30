/**
 * Fail-fast budget for /api/store so full-screen Loading cannot hang until
 * Postgres or the Worker times out. Keep these in lockstep: fetch abort,
 * auth wait, and bootstrap UI wait all share the same ceiling.
 */
export const STORE_FETCH_TIMEOUT_MS = 8000;
export const STORE_AUTH_WAIT_MS = 8000;
export const BOOTSTRAP_UI_TIMEOUT_MS = 8000;
