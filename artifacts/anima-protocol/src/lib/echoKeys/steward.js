// @ts-check
/**
 * The full Echo Key Codex is granted only to the Protocol steward (Dàvīn).
 * Other operators keep the starter-Shard discovery path.
 *
 * The steward is decided by the server (`GET /api/account/role`, merged into
 * the user object as `is_steward` by animaClient.auth.me()). No email or
 * GitHub handle ships in the client bundle (security audit 2026-11-14, L3),
 * and a generic admin role does not grant it.
 */

/**
 * @param {unknown} user
 */
export function isEchoLibrarySteward(user) {
  if (!user || typeof user !== "object") return false;
  return /** @type {Record<string, unknown>} */ (user).is_steward === true;
}
