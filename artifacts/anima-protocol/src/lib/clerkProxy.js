/**
 * Clerk Frontend API proxy URL helpers.
 *
 * Clerk requires proxyUrl to end with a trailing slash and to match the Proxy URL
 * configured in the Clerk dashboard exactly (production uses www.anima-protocol.com).
 */

const ANIMA_WWW = 'https://www.anima-protocol.com';

function clerkProxyEnvValue() {
  return typeof import.meta.env.VITE_CLERK_PROXY_URL === 'string'
    ? import.meta.env.VITE_CLERK_PROXY_URL.trim()
    : '';
}

export function isClerkProxyExplicitlyDisabled() {
  const value = clerkProxyEnvValue().toLowerCase();
  return value === 'none' || value === 'false' || value === 'off';
}

function configuredClerkProxyUrl() {
  const value = clerkProxyEnvValue();
  if (!value || isClerkProxyExplicitlyDisabled()) {
    return '';
  }
  return ensureTrailingSlash(value);
}

export function isLocalDevHostname(hostname) {
  const host = (hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1')
  );
}

export function isAnimaProductionHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return (
    host === 'anima-protocol.com' ||
    host === 'www.anima-protocol.com' ||
    host.endsWith('.anima-protocol.com')
  );
}

export function ensureTrailingSlash(url) {
  if (!url) return '';
  return url.endsWith('/') ? url : `${url}/`;
}

function decodePublishableKeyPayload(clerkPubKey) {
  if (typeof clerkPubKey !== 'string') return '';
  const payload = clerkPubKey.split('_').slice(2).join('_');
  if (!payload) return '';
  try {
    return atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return '';
  }
}

export function clerkFrontendApiHost(clerkPubKey) {
  return decodePublishableKeyPayload(clerkPubKey).replace(/\$$/, '');
}

export function clerkFrontendApiBase(clerkPubKey) {
  const host = clerkFrontendApiHost(clerkPubKey);
  return host ? `https://${host}` : '';
}

/**
 * Absolute proxy URL for the API Clerk-Proxy-Url header (dashboard uses www).
 */
export function animaProductionClerkProxyUrl() {
  return `${ANIMA_WWW}/api/__clerk/`;
}

/**
 * Client-side proxyUrl for ClerkProvider.
 *
 * Must be a **relative** path so Clerk loads clerk-js from
 * `/api/__clerk/npm/@clerk/clerk-js@…` on the same origin. An absolute
 * https://www… URL makes Clerk build a broken script URL and the SDK never
 * reaches `clerk.loaded`.
 */
export function clerkProviderProxyPath() {
  return '/api/__clerk/';
}

/**
 * Whether pk_live_ should route Clerk FAPI through the same-origin proxy.
 */
export function shouldUseClerkProxy(clerkPubKey) {
  if (isClerkProxyExplicitlyDisabled()) return false;
  if (configuredClerkProxyUrl()) return true;
  if (typeof clerkPubKey !== 'string' || !clerkPubKey.startsWith('pk_live_')) {
    return false;
  }
  if (typeof window === 'undefined') return false;

  const host = window.location.hostname;
  if (import.meta.env.DEV && isLocalDevHostname(host)) return true;
  if (import.meta.env.PROD && isAnimaProductionHost(host)) return true;
  return false;
}

/**
 * Resolved proxy URL for ClerkProvider, or "" when Clerk should talk directly.
 */
export function resolveClerkProxyUrl(clerkPubKey) {
  if (isClerkProxyExplicitlyDisabled()) return '';

  const configured = configuredClerkProxyUrl();
  if (configured) return configured;

  if (!shouldUseClerkProxy(clerkPubKey)) return '';

  return clerkProviderProxyPath();
}

/**
 * Absolute base URL for connectivity probes (fetch from the browser).
 */
export function clerkProxyProbeBase(clerkPubKey) {
  const proxy = resolveClerkProxyUrl(clerkPubKey);
  if (!proxy) return '';
  if (proxy.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${proxy.replace(/\/$/, '')}`;
  }
  return proxy.replace(/\/$/, '');
}

/** clerk-js bundle path served through the Clerk proxy when proxyUrl is relative. */
export function clerkJsScriptProbeUrl(clerkPubKey) {
  const base = clerkProxyProbeBase(clerkPubKey);
  if (!base) return '';
  return `${base}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
}

export async function shouldFallbackToDirectClerk(
  clerkPubKey,
  fetchImpl = fetch,
) {
  const proxyBase = clerkProxyProbeBase(clerkPubKey);
  const directBase = clerkFrontendApiBase(clerkPubKey);
  if (!proxyBase || !directBase) return false;

  const fetchOptions = () => ({
    credentials: 'omit',
    signal:
      typeof AbortSignal !== 'undefined' &&
      typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5000)
        : undefined,
  });

  try {
    const proxyRes = await fetchImpl(
      `${proxyBase}/v1/environment`,
      fetchOptions(),
    );
    if (proxyRes.ok) return false;
  } catch {
    // If the proxy cannot be reached, try direct Clerk before falling back.
  }

  try {
    const directRes = await fetchImpl(
      `${directBase}/v1/environment`,
      fetchOptions(),
    );
    return directRes.ok;
  } catch {
    return false;
  }
}
