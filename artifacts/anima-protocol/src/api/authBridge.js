// Shared Clerk token/header bridge for non-React API clients.
import {
  STORE_AUTH_WAIT_MS,
  STORE_TOKEN_TIMEOUT_MS,
  withStoreTimeout,
} from "@/lib/storeTimeouts";
let tokenGetter = null;

export function setAuthTokenGetter(fn) {
  tokenGetter = typeof fn === 'function' ? fn : null;
}

export function clearAuthTokenGetter() {
  tokenGetter = null;
}

export function hasAuthTokenGetter() {
  return typeof tokenGetter === "function";
}

function tokenTimeoutError() {
  const err = new Error("Auth token timed out");
  err.code = "timeout";
  return err;
}

/**
 * Resolve a bearer token from the registered getter.
 *
 * Guards against the setState-style mistake
 * `setAuthTokenGetter(() => async () => token)` which would otherwise stringify
 * the inner function into `Authorization: Bearer async () => …` and break every
 * authenticated write (add-from-series, character features, seeding).
 *
 * Clerk `getToken()` has no abort — a hung getter used to block `storeFetch`
 * and `auth.me()` forever because AbortSignal.timeout is applied only after
 * this resolves. Fail the getter after STORE_TOKEN_TIMEOUT_MS (or options.timeoutMs).
 */
function settleWithTimeout(value, timeoutMs) {
  if (value == null || typeof value.then !== "function") {
    return Promise.resolve(value);
  }
  return withStoreTimeout(value, timeoutMs, tokenTimeoutError);
}

export async function getToken(options = {}) {
  if (!tokenGetter) return null;
  const { timeoutMs = STORE_TOKEN_TIMEOUT_MS, ...getterOptions } = options;
  const budget =
    typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : STORE_TOKEN_TIMEOUT_MS;
  const deadline = Date.now() + budget;
  try {
    // Sync getters must not schedule a timer — store-sync tests (and any
    // fake-timer suite) would otherwise stall until the token budget fires.
    let token = await settleWithTimeout(tokenGetter(getterOptions), budget);
    // Unwrap one accidental extra function layer.
    if (typeof token === "function") {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      token = await settleWithTimeout(token(getterOptions), remaining);
    }
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function waitForStoreAuth(timeoutMs = STORE_AUTH_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const token = await getToken({ timeoutMs: remaining });
    if (token) return token;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Store auth token not available');
}

/**
 * One-shot token for a store read. If Clerk is still minting (common on iPad
 * Safari after the proxy handshake), wait the store-auth budget instead of
 * treating "not ready yet" as an empty roster / missing chat.
 */
/**
 * Fail-open Clerk wait used by roster, chat-open, and Customise Anima lists.
 * Returns the token, or null if minting does not finish in time.
 */
export async function awaitCompanionStoreAuth(timeoutMs = STORE_AUTH_WAIT_MS) {
  try {
    return await waitForStoreAuth(timeoutMs);
  } catch {
    return null;
  }
}

export async function resolveStoreToken(timeoutMs = STORE_AUTH_WAIT_MS) {
  const immediate = await getToken();
  if (immediate) return immediate;
  if (!hasAuthTokenGetter()) return null;
  return awaitCompanionStoreAuth(timeoutMs);
}

export function publicOriginHeaders() {
  if (typeof window === 'undefined' || !window.location?.host) return {};
  return {
    'X-Anima-Public-Host': window.location.host,
    'X-Forwarded-Host': window.location.host,
    'X-Forwarded-Proto': window.location.protocol.replace(':', ''),
  };
}

export async function authHeaders(extra, options = {}) {
  const token = await getToken(options);
  const headers = {
    'Content-Type': 'application/json',
    ...publicOriginHeaders(),
    ...extra,
  };
  if (typeof token === 'string' && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
