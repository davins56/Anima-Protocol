/**
 * Post-auth session establishment for every Clerk sign-in method
 * (email OTP, GitHub OAuth, existing-session resume).
 *
 * Clerk JS can report `isSignedIn` before a JWT is readable. Navigating to
 * Home in that window shows MainHome with no store token — the
 * "Home but not logged in" production failure.
 */

export const CLERK_SESSION_WAIT_MS = 8_000;

export function isUsableClerkSessionToken(token) {
  if (typeof token !== "string") return false;
  const value = token.trim();
  if (!value) return false;
  if (value.startsWith("local_")) return false;
  return value.length > 20;
}

/**
 * Poll Clerk `getToken` until a real session JWT appears, or time out.
 *
 * @param {(options?: { skipCache?: boolean }) => Promise<unknown>} getTokenFn
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<string | null>}
 */
export async function waitForClerkSessionToken(
  getTokenFn,
  { timeoutMs = CLERK_SESSION_WAIT_MS, intervalMs = 100 } = {},
) {
  if (typeof getTokenFn !== "function") return null;
  const deadline = Date.now() + timeoutMs;
  let skipCache = false;
  while (Date.now() < deadline) {
    try {
      const token = await getTokenFn(skipCache ? { skipCache: true } : {});
      if (isUsableClerkSessionToken(token)) return token;
    } catch {
      /* retry */
    }
    skipCache = true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => {
      setTimeout(resolve, Math.min(intervalMs, remaining));
    });
  }
  return null;
}

export function resolveSignedInUser({
  clerkSignedIn = false,
  clerkUserId = "",
  sessionTokenReady = false,
} = {}) {
  return Boolean(clerkSignedIn && clerkUserId && sessionTokenReady);
}
