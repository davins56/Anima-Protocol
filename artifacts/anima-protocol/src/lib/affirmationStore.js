/**
 * Sacred Space / Therapy Mode affirmation persistence.
 * Store/auth failures must surface as copy the operator can see — never a
 * silent no-op on Add or the initial seed.
 *
 * Sacred Space init must wait for Clerk mint before arming the list timeout.
 * #437 started Affirmation.filter immediately after that wait, but still
 * wrapped it in withStoreTimeout (list + token slack). A late resolve is
 * ignored, and that clock is shorter than mint-inside-filter + storeFetch
 * abort + retry — iPad sticky AFFIRMATION_LOAD_TIMEOUT. Pass the minted
 * Bearer; do not race filter with a second wall-clock.
 */

import { awaitCompanionStoreAuth } from "@/api/authBridge";
import { isStoreTimeoutError } from "@/lib/storeErrorSignals";
import {
  STORE_AUTH_WAIT_MS,
  STORE_FETCH_TIMEOUT_MS,
  STORE_LIST_RETRY_LIMIT,
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
 * Store rows are already scoped by Clerk user_id. Sacred Space may list
 * `{ is_active: true }` before clerkUser.email hydrates (iPad). Other
 * callers still require email so Add/seed cannot silently drop user_email.
 *
 * @param {{
 *   user: { email?: string } | null,
 *   filter: (query: Record<string, unknown>) => Promise<unknown[]>,
 *   requireEmail?: boolean,
 * }} input
 * @returns {Promise<unknown[]>}
 */
export async function loadAffirmations({ user, filter, requireEmail = true }) {
  if (requireEmail && !user?.email) {
    const err = new Error(AFFIRMATION_AUTH_REQUIRED);
    err.code = "auth";
    throw err;
  }
  const query = { is_active: true };
  if (user?.email) query.user_email = user.email;
  let existing;
  try {
    existing = await filter(query);
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

/** Already-settled value, else fallback — never wait on a hung roster/profile. */
function takeIfSettled(promise, fallback) {
  return Promise.race([promise, Promise.resolve(fallback)]);
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
 * Last-resort hang cap for a filter that never settles (tests, missing abort).
 * Must cover storeFetch abort + retry — not one STORE_LIST window. #437's
 * list+slack race fired during ensureSchemaOnce() and ignored the late GET.
 */
function affirmationListHangCapMs(listTimeoutMs, listTimeoutSlackMs) {
  const attemptMs = Math.max(0, Number(listTimeoutMs) || 0);
  const slackMs = Math.max(0, Number(listTimeoutSlackMs) || 0);
  return attemptMs * (STORE_LIST_RETRY_LIMIT + 1) + slackMs;
}

function callAffirmationFilter(filter, query, token) {
  if (typeof filter !== "function") return [];
  const opts =
    typeof token === "string" && token.length > 0
      ? { token, waitForAuth: false }
      : { waitForAuth: false };
  return filter(query, opts);
}

async function awaitAffirmationList(filterPromise, hangCapMs) {
  try {
    return await withStoreTimeout(
      filterPromise,
      hangCapMs,
      affirmationLoadTimeoutError,
    );
  } catch (err) {
    if (isStoreTimeoutError(err)) {
      throw err?.message === AFFIRMATION_LOAD_TIMEOUT
        ? err
        : affirmationLoadTimeoutError();
    }
    throw err;
  }
}

/**
 * Sacred Space first paint: wait for the store token, then list affirmations.
 * #437 started filter immediately but still raced it with withStoreTimeout
 * (list + token slack). That leftover helper paints AFFIRMATION_LOAD_TIMEOUT
 * and ignores a late Affirmation.filter — the iPad sticky banner after #437.
 *
 * After waitForAuth, pass that Bearer into Affirmation.filter (email optional;
 * store is user_id scoped). storeFetch owns abort + retry. The hang cap only
 * covers a filter that never settles, and late rows still reach onExisting.
 * auth.me() / Anima.list never throw AFFIRMATION_LOAD_TIMEOUT. Empty `[]`
 * is not a timeout. A 401 is not this banner.
 *
 * @param {{
 *   loadUser: () => Promise<{ email?: string } | null>,
 *   peekUser?: () => { email?: string } | null | Promise<{ email?: string } | null>,
 *   filter: (
 *     query: Record<string, unknown>,
 *     opts?: { token?: string, waitForAuth?: boolean },
 *   ) => Promise<unknown[]>,
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
 *   onExisting?: (result: {
 *     me: { email?: string } | null,
 *     existing: unknown[],
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
  onExisting,
} = {}) {
  void userTimeoutMs;
  // Auth wait is NOT covered by any fetch AbortSignal. After OTP, Clerk mint
  // can take seconds — if that wait shares the list budget, Sacred Space
  // paints defaults before Affirmation.filter can run.
  const token = await waitForAuth(authWaitMs);

  // Immediate peek only — do not poll for email. iPad often has isSignedIn
  // with email "" for seconds; that wait used to own this banner.
  const peeked = await readPeekUser(peekUser);
  const userPromise =
    typeof loadUser === "function"
      ? Promise.resolve()
          .then(loadUser)
          .then((row) => sacredSpaceUser(row))
          .catch(() => null)
      : Promise.resolve(null);

  // Filter starts now with the minted Bearer. Do not wrap it in #437's
  // list+slack race — storeFetch abort+retry is longer, and a late GET
  // must still replace sticky defaults.
  const filterPromise = Promise.resolve()
    .then(() =>
      loadAffirmations({
        user: peeked,
        filter: (query) => callAffirmationFilter(filter, query, token),
        requireEmail: false,
      }),
    )
    .then((rows) => (Array.isArray(rows) ? rows : []));

  let releasedEarly = false;
  if (typeof onExisting === "function") {
    void filterPromise
      .then((rows) => {
        if (!releasedEarly) return;
        onExisting({ me: peeked, existing: rows });
      })
      .catch(() => {});
  }

  const rawAnima = safeRosterList(listAnimas);
  const rawChars = safeRosterList(listCharacters);
  const animaPromise = settleRosterList(rawAnima, rosterTimeoutMs);
  const charsPromise = settleRosterList(rawChars, rosterTimeoutMs);
  if (typeof onRoster === "function") {
    void Promise.all([userPromise, rawAnima, rawChars]).then(
      ([loaded, animas, chars]) => {
        onRoster({ me: loaded || peeked, animas, chars });
      },
    );
  }

  let existing;
  try {
    existing = await awaitAffirmationList(
      filterPromise,
      affirmationListHangCapMs(listTimeoutMs, listTimeoutSlackMs),
    );
  } catch (err) {
    releasedEarly = true;
    throw err;
  }
  // Do not hold Attuning for /profile or a hung Anima/Character list.
  const me = (await takeIfSettled(userPromise, peeked)) || peeked;
  const animas = await takeIfSettled(animaPromise, []);
  const chars = await takeIfSettled(charsPromise, []);

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
