// Shared Clerk token/header bridge for non-React API clients.
let tokenGetter = null;

export function setAuthTokenGetter(fn) {
  tokenGetter = typeof fn === 'function' ? fn : null;
}

export function clearAuthTokenGetter() {
  tokenGetter = null;
}

/**
 * Resolve a bearer token from the registered getter.
 *
 * Guards against the setState-style mistake
 * `setAuthTokenGetter(() => async () => token)` which would otherwise stringify
 * the inner function into `Authorization: Bearer async () => …` and break every
 * authenticated write (add-from-series, character features, seeding).
 */
export async function getToken(options = {}) {
  if (!tokenGetter) return null;
  try {
    let token = await tokenGetter(options);
    // Unwrap one accidental extra function layer.
    if (typeof token === 'function') {
      token = await token(options);
    }
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function waitForStoreAuth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = await getToken();
    if (token) return token;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Store auth token not available');
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
