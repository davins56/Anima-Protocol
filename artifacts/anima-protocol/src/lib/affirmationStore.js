/**
 * Sacred Space / Therapy Mode affirmation persistence.
 * Store/auth failures must surface as copy the operator can see — never a
 * silent no-op on Add or the initial seed.
 */

export const AFFIRMATION_AUTH_REQUIRED = "Sign in to save affirmations.";
export const AFFIRMATION_EMPTY_TEXT = "Write an affirmation before adding.";
export const AFFIRMATION_LOAD_FAILED =
  "Could not load affirmations. The store may be unavailable.";
export const AFFIRMATION_ADD_FAILED =
  "Could not add that affirmation. The store may be unavailable.";
export const AFFIRMATION_SEED_FAILED =
  "Could not seed default affirmations. The store may be unavailable.";

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
 * @param {{
 *   user: { email?: string } | null,
 *   filter: (query: Record<string, unknown>) => Promise<unknown[]>,
 *   create: (row: Record<string, unknown>) => Promise<unknown>,
 *   defaults: Array<{ text: string, category: string }>,
 * }} input
 */
export async function loadAndSeedAffirmations({
  user,
  filter,
  create,
  defaults,
}) {
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
    wrapped.cause = err;
    throw wrapped;
  }
  const rows = Array.isArray(existing) ? existing : [];
  if (rows.length > 0) return rows;

  try {
    return await Promise.all(
      defaults.map((row) =>
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
