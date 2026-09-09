/**
 * Sacred Space / Therapy Mode affirmation persistence.
 * Store/auth failures must surface as copy the operator can see — never a
 * silent no-op on Add or the initial seed.
 *
 * Sacred Space init must wait for Clerk mint before arming the list timeout.
 * #436 split Affirmation vs Anima/Character STORE_LIST clocks after that wait,
 * but still ran auth.me() through runSacredSpaceStep under STORE_FETCH (8s).
 * That leftover path is the post-#436 iPad banner: /profile + ensureSchemaOnce
 * lost the 8s race, AFFIRMATION_LOAD_TIMEOUT painted, and filter never started.
 */

import { awaitCompanionStoreAuth } from "@/api/authBridge";
import { isStoreTimeoutError } from "@/lib/storeErrorSignals";
import {
  STORE_AUTH_WAIT_MS,
  STORE_FETCH_TIMEOUT_MS,
  STORE_LIST_TIMEOUT_MS,
  withStoreTimeout,
} from "@/lib/storeTimeouts";

export const AFFIRMATION_AUTH_REQUIRED = "Sign in to save affirmations.";
export const AFFIRMATION_EMPTY_TEXT = "Write an affirmation before adding.";
export const AFFIRMATION_LOAD_FAILED =
  "Could not load affirmations. The store may be unavailable.";
export const AFFIRMATION_ADD_FAILED =
  "Could not add that affirmation. The store may be unavailable.";
export const AFFIRMATION_SEED_FAILED =
  "Could not seed default affirmations. The store may be unavailable.";
export const AFFIRMATION_LOAD_TIMEOUT =
  "Sacred Space took too long to load. Showing default affirmations.";
export const LOCAL_AFFIRMATION_ID_PREFIX = "local-affirmation-";

/**
 * @param {unknown} err
 * @param {string} fallback
 * @returns {string}
 */
export function affirmationErrorMessage(err, fallback) {
  if (!err) return fallback;
  const status = Number(err.status);
  if (status === 401 || status === 403) {
    return AFFIRMATION_AUTH_REQUIRED;
  }
  const raw =
    err instanceof Error
      ? String(err.message || "").trim()
      : typeof err === "string"
        ? err.trim()
        : "";
  if (!raw) return fallback;
  return raw;
}

/**
 * @param {{ text?: string, user?: { email?: string } | null }} input
 * @returns {string | null}
 */
export function validateAddAffirmation({ text, user } = {}) {
  if (!String(text || "").trim()) return AFFIRMATION_EMPTY_TEXT;
  if (!user?.email) return AFFIRMATION_AUTH_REQUIRED;
  return null;
}

/**
 * @param {{
 *   user: { email?: string } | null,
 *   text: string,
 *   category: string,
 *   create: (row: Record<string, unknown>) => Promise<unknown>,
 * }} input
 */
export async function createUserAffirmation({
  user,
  text,
  category,
  create,
}) {
  const invalid = validateAddAffirmation({ text, user });
  if (invalid) {
    const err = new Error(invalid);
    err.code = user?.email ? "validation" : "auth";
    throw err;
  }
  try {
    return await create({
      text: String(text).trim(),
      category,
      user_email: user.email,
      is_active: true,
    });
  } catch (err) {
    const wrapped = new Error(
      affirmationErrorMessage(err, AFFIRMATION_ADD_FAILED),
    );
    wrapped.status = err?.status;
    wrapped.cause = err;
    throw wrapped;
  }
}

/**
 * In-memory defaults so Sacred Space can render when the store is empty,
 * slow, or unreachable. First paint must not wait on seed creates.
 *
 * @param {Array<{ text: string, category: string, id?: string }>} defaults
 * @returns {Array<Record<string, unknown>>}
 */
export function asLocalAffirmations(defaults = []) {
  return defaults.map((row, index) => ({
    ...row,
    id: row.id || `${LOCAL_AFFIRMATION_ID_PREFIX}${index}`,
    is_default: true,
    is_active: true,
    is_local: true,
  }));
}

export function isLocalAffirmationId(id) {
  return String(id || "").startsWith(LOCAL_AFFIRMATION_ID_PREFIX);
}

/**
 * Load persisted affirmations only — never creates seed rows.
 *
 * @param {{
 *   user: { email?: string } | null,
 *   filter: (query: Record<string, unknown>) => Promise<unknown[]>,
 * }} input
 * @returns {Promise<unknown[]>}
 */
export async function loadAffirmations({ user, filter }) {
  if (!user?.email) {
    const err = new Error(AFFIRMATION_AUTH_REQUIRED);
    err.code = "auth";
    throw err;
  }
  let existing;
  try {
    existing = await filter({ user_email: user.email, is_active: true });
  } catch (err) {
    const wrapped = new Error(
      affirmationErrorMessage(err, AFFIRMATION_LOAD_FAILED),
    );
    wrapped.status = err?.status;
    wrapped.code = err?.code;
    wrapped.cause = err;
    throw wrapped;
  }
  return Array.isArray(existing) ? existing : [];
}

function affirmationLoadTimeoutError() {
  const err = new Error(AFFIRMATION_LOAD_TIMEOUT);
  err.code = "timeout";
  return err;
}

function sacredSpaceUser(candidate) {
  if (candidate && typeof candidate === "object" && candidate.email) {
    return candidate;
  }
  return null;
}

async function readPeekUser(peekUser) {
  if (typeof peekUser !== "function") return null;
  try {
    return sacredSpaceUser(await Promise.resolve().then(peekUser));
  } catch {
    return null;
  }
}

/**
 * iPad Safari often has isSignedIn before clerkUser.email hydrates.
 * Poll peek (syncIdentity) — do not wait on auth.me() /profile for that email.
 */
async function waitForPeekUser(peekUser, timeoutMs) {
  if (typeof peekUser !== "function") return null;
  const budget = Number(timeoutMs);
  if (!Number.isFinite(budget) || budget <= 0) {
    return readPeekUser(peekUser);
  }
  const deadline = Date.now() + budget;
  let peeked = await readPeekUser(peekUser);
  while (!peeked && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    peeked = await readPeekUser(peekUser);
  }
  return peeked;
}

function safeRosterList(listFn) {
  return typeof listFn === "function"
    ? Promise.resolve()
        .then(listFn)
        .then((rows) => (Array.isArray(rows) ? rows : []))
        .catch(() => [])
    : Promise.resolve([]);
}

/**
 * Companions list gets its own AbortSignal / wall-clock. A timeout here must
 * not become AFFIRMATION_LOAD_TIMEOUT, and must not share the filter budget.
 */
async function settleRosterList(listPromise, timeoutMs) {
  try {
    return await withStoreTimeout(listPromise, timeoutMs, () => {
      const err = new Error("roster timeout");
      err.code = "timeout";
      return err;
    });
  } catch {
    return [];
  }
}

/**
 * Fresh wall-clock for one Sacred Space step. A late resolve is ignored so a
 * hung auth.me() or filter cannot leak into the next step's budget.
 *
 * @template T
 * @param {() => Promise<T>} run
 * @param {{
 *   waitForAuth: (timeoutMs?: number) => Promise<unknown>,
 *   authWaitMs: number,
 *   timeoutMs: number,
 * }} opts
 * @returns {Promise<T>}
 */
async function runSacredSpaceStep(run, { waitForAuth, authWaitMs, timeoutMs }) {
  try {
    return await withStoreTimeout(run(), timeoutMs, affirmationLoadTimeoutError);
  } catch (err) {
    if (!isStoreTimeoutError(err)) throw err;
    await waitForAuth(authWaitMs);
    return await withStoreTimeout(run(), timeoutMs, affirmationLoadTimeoutError);
  }
}

/**
 * Sacred Space first paint: mint the store token, peek the Clerk email, then
 * list affirmations with a fresh STORE_LIST budget. #436 still required
 * auth.me() to finish under STORE_FETCH before filter started — /profile
 * ensureSchemaOnce() on iPad lost that 8s race and painted this banner
 * without ever calling Affirmation.filter.
 *
 * Peek + filter are independent of the profile GET. Anima/Character.list
 * stay fail-open and never raise AFFIRMATION_LOAD_TIMEOUT. An empty filter
 * result (no token / 401-as-[]) is not a timeout — that path seeds defaults
 * without this banner.
 *
 * @param {{
 *   loadUser: () => Promise<{ email?: string } | null>,
 *   peekUser?: () => { email?: string } | null | Promise<{ email?: string } | null>,
 *   filter: (query: Record<string, unknown>) => Promise<unknown[]>,
 *   listAnimas?: () => Promise<unknown[]>,
 *   listCharacters?: () => Promise<unknown[]>,
 *   waitForAuth?: (timeoutMs?: number) => Promise<unknown>,
 *   listTimeoutMs?: number,
 *   listTimeoutSlackMs?: number,
 *   userTimeoutMs?: number,
 *   rosterTimeoutMs?: number,
 *   authWaitMs?: number,
 *   onRoster?: (roster: {
 *     me: { email?: string } | null,
 *     animas: unknown[],
 *     chars: unknown[],
 *   }) => void,
 * }} input
 * @returns {Promise<{
 *   me: { email?: string } | null,
 *   existing: unknown[],
 *   animas: unknown[],
 *   chars: unknown[],
 * }>}
 */
export async function loadSacredSpaceSnapshot({
  loadUser,
  peekUser,
  filter,
  listAnimas,
  listCharacters,
  waitForAuth = (timeoutMs) => awaitCompanionStoreAuth(timeoutMs),
  listTimeoutMs = STORE_LIST_TIMEOUT_MS,
  listTimeoutSlackMs = 0,
  userTimeoutMs = STORE_FETCH_TIMEOUT_MS,
  rosterTimeoutMs = STORE_LIST_TIMEOUT_MS,
  authWaitMs = STORE_AUTH_WAIT_MS,
  onRoster,
} = {}) {
  // Auth wait is NOT covered by any fetch AbortSignal. After OTP, Clerk mint
  // can take seconds — if that wait shares the list budget, Sacred Space
  // paints defaults before Affirmation.filter can run.
  await waitForAuth(authWaitMs);

  // Clerk email is already on syncIdentity after sign-in, or arrives once
  // clerkUser hydrates (common on iPad). Do not wait for auth.me() /profile
  // (STORE_FETCH 8s + ensureSchemaOnce) before filter.
  const peeked = await waitForPeekUser(peekUser, authWaitMs);
  let me = peeked;
  if (!me) {
    me = sacredSpaceUser(
      await runSacredSpaceStep(() => Promise.resolve().then(loadUser), {
        waitForAuth,
        authWaitMs,
        timeoutMs: userTimeoutMs,
      }),
    );
    if (!me) {
      const err = new Error(AFFIRMATION_AUTH_REQUIRED);
      err.code = "auth";
      throw err;
    }
  } else if (typeof loadUser === "function") {
    // Warm the profile cache in the background. A hung GET must not hold
    // Attuning or own AFFIRMATION_LOAD_TIMEOUT after peek already has email.
    void Promise.resolve().then(loadUser).catch(() => {});
  }

  // Slack covers getToken() inside storeFetch after this clock starts, so the
  // outer withStoreTimeout cannot beat Affirmation.filter's own 20s abort.
  const filterBudget =
    Number(listTimeoutMs) + Math.max(0, Number(listTimeoutSlackMs) || 0);

  // After auth+peek, each list arms its own budget. #436 still waited for
  // auth.me() first — that leftover 8s profile clock painted sticky defaults
  // even when filter would have succeeded.
  const existingPromise = runSacredSpaceStep(
    () => loadAffirmations({ user: me, filter }),
    { waitForAuth, authWaitMs, timeoutMs: filterBudget },
  );
  const rawAnima = safeRosterList(listAnimas);
  const rawChars = safeRosterList(listCharacters);
  const animaPromise = settleRosterList(rawAnima, rosterTimeoutMs);
  const charsPromise = settleRosterList(rawChars, rosterTimeoutMs);
  if (typeof onRoster === "function") {
    void Promise.all([rawAnima, rawChars]).then(([animas, chars]) => {
      onRoster({ me, animas, chars });
    });
  }

  const existing = await existingPromise;
  const [animas, chars] = await Promise.all([animaPromise, charsPromise]);

  return {
    me,
    existing: Array.isArray(existing) ? existing : [],
    animas,
    chars,
  };
}

/**
 * Persist default affirmations. Call after first paint — never block Attuning.
 *
 * @param {{
 *   user: { email?: string } | null,
 *   create: (row: Record<string, unknown>) => Promise<unknown>,
 *   defaults: Array<{ text: string, category: string }>,
 * }} input
 */
export async function seedDefaultAffirmations({ user, create, defaults }) {
  if (!user?.email) {
    const err = new Error(AFFIRMATION_AUTH_REQUIRED);
    err.code = "auth";
    throw err;
  }
  try {
    return await Promise.all(
      (defaults || []).map((row) =>
        create({
          ...row,
          user_email: user.email,
          is_default: true,
          is_active: true,
        }),
      ),
    );
  } catch (err) {
    const wrapped = new Error(
      affirmationErrorMessage(err, AFFIRMATION_SEED_FAILED),
    );
    wrapped.status = err?.status;
    wrapped.cause = err;
    throw wrapped;
  }
}

/**
 * Load existing rows. When the store is empty, return in-memory defaults
 * immediately and seed in the background unless `seedInBackground` is false.
 *
 * @param {{
 *   user: { email?: string } | null,
 *   filter: (query: Record<string, unknown>) => Promise<unknown[]>,
 *   create: (row: Record<string, unknown>) => Promise<unknown>,
 *   defaults: Array<{ text: string, category: string }>,
 *   seedInBackground?: boolean,
 *   onSeeded?: (rows: unknown[]) => void,
 *   onSeedError?: (err: Error) => void,
 * }} input
 */
export async function loadAndSeedAffirmations({
  user,
  filter,
  create,
  defaults,
  seedInBackground = true,
  onSeeded,
  onSeedError,
}) {
  const rows = await loadAffirmations({ user, filter });
  if (rows.length > 0) return rows;

  if (!seedInBackground) {
    return seedDefaultAffirmations({ user, create, defaults });
  }

  const local = asLocalAffirmations(defaults);
  Promise.resolve()
    .then(() => seedDefaultAffirmations({ user, create, defaults }))
    .then((seeded) => {
      onSeeded?.(seeded);
    })
    .catch((err) => {
      onSeedError?.(err);
    });
  return local;
}
