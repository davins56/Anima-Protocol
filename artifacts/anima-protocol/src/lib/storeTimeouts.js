/**
 * Fail-fast budget for /api/store so full-screen Loading cannot hang until
 * Postgres or the Worker times out. Keep these in lockstep: fetch abort,
 * auth wait, and bootstrap UI wait all share the same ceiling.
 *
 * ChatSession.create / Init and TherapyTopic.create are the exceptions: one
 * insert after a Worker cold start + Hyperdrive can exceed 8s even when the
 * write is healthy. Do not raise STORE_FETCH_TIMEOUT_MS for that — use the
 * targeted create budgets below (see createInitChatSession, NewSessionModal,
 * beginBundledStarterUpsert, and createTherapyTopic). Bundled starter upsert
 * is fail-open so it cannot spend this create budget before the insert.
 */
export const STORE_FETCH_TIMEOUT_MS = 8000;
export const STORE_AUTH_WAIT_MS = 8000;
export const BOOTSTRAP_UI_TIMEOUT_MS = 8000;
/** Targeted wall-clock budget for POST /api/store/ChatSession (Init / create). */
export const STORE_SESSION_CREATE_TIMEOUT_MS = 20000;
/** Extra create attempts after the first abort/timeout (Init only). */
export const STORE_SESSION_CREATE_RETRY_LIMIT = 1;
/** Same 20s budget for POST /api/store/TherapyTopic — do not raise the global 8s cap. */
export const STORE_TOPIC_CREATE_TIMEOUT_MS = STORE_SESSION_CREATE_TIMEOUT_MS;
/** Extra create attempts after the first timeout/503 reset (TherapyTopic). */
export const STORE_TOPIC_CREATE_RETRY_LIMIT = STORE_SESSION_CREATE_RETRY_LIMIT;
