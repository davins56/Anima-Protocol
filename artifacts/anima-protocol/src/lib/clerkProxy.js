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

/**
 * Production Clerk dashboard Proxy URL (must match Clerk-Proxy-Url on the API).
 */
export function animaProductionClerkProxyUrl() {
  return `${ANIMA_WWW}/api/__clerk/`;
}

function sameOriginClerkProxyUrl() {
  if (typeof window === 'undefined') return '';
  if (import.meta.env.PROD && isAnimaProductionHost(window.location.hostname)) {
    return animaProductionClerkProxyUrl();
  }
  return ensureTrailingSlash(`${window.location.origin}/api/__clerk`);
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

  return sameOriginClerkProxyUrl();
}

/**
 * Probe URL for connectivity checks (no trailing slash before path segments).
 */
export function clerkProxyProbeBase(clerkPubKey) {
  const proxy = resolveClerkProxyUrl(clerkPubKey);
  return proxy ? proxy.replace(/\/$/, '') : '';
}
