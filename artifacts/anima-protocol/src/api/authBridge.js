// Shared Clerk token/header bridge for non-React API clients.
let tokenGetter = null;

export function setAuthTokenGetter(fn) {
  tokenGetter = fn;
}

export function clearAuthTokenGetter() {
  tokenGetter = null;
}

export async function getToken(options = {}) {
  if (!tokenGetter) return null;
  try {
    return await tokenGetter(options);
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
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
