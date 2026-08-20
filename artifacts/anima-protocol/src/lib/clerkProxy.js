/**
 * Clerk Frontend API proxy URL helpers.
 *
 * Cloudflare is the production host. Clerk should connect directly by default.
 * A proxy is used only when VITE_CLERK_PROXY_URL is explicitly configured.
 */

export const ANIMA_APEX_HOST = 'anima-protocol.com';
const ANIMA_WWW = `https://www.${ANIMA_APEX_HOST}`;

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

export function isVercelPreviewHost(hostname) {
  return (hostname || '').toLowerCase().endsWith('.vercel.app');
}

export function isAnimaProductionHost(hostname) {
  const host = (hostname || '').toLowerCase().replace(/:\d+$/, '');
  return (
    host === ANIMA_APEX_HOST ||
    host === `www.${ANIMA_APEX_HOST}` ||
    host.endsWith(`.${ANIMA_APEX_HOST}`)
  );
}

export function ensureTrailingSlash(url) {
  if (!url) return '';
  return url.endsWith('/') ? url : `${url}/`;
}

/** Legacy same-origin proxy URL, retained for explicitly configured deployments. */
export function animaProductionClerkProxyUrl() {
  return `${ANIMA_WWW}/api/__clerk/`;
}

/** Legacy relative proxy path, retained for explicitly configured deployments. */
export function clerkProviderProxyPath() {
  return '/api/__clerk/';
}

/**
 * Use a Clerk proxy only when the operator explicitly configured one.
 * Production no longer auto-enables /api/__clerk merely because the key is pk_live_.
 */
export function shouldUseClerkProxy() {
  if (isClerkProxyExplicitlyDisabled()) return false;
  return Boolean(configuredClerkProxyUrl());
}

/** Resolved proxy URL for ClerkProvider, or "" for Clerk's direct connection. */
export function resolveClerkProxyUrl() {
  if (isClerkProxyExplicitlyDisabled()) return '';
  return configuredClerkProxyUrl();
}

/** Absolute base URL for proxy connectivity probes, when a proxy is configured. */
export function clerkProxyProbeBase() {
  const proxy = resolveClerkProxyUrl();
  if (!proxy) return '';
  if (proxy.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${proxy.replace(/\/$/, '')}`;
  }
  return proxy.replace(/\/$/, '');
}

/** clerk-js bundle path for connectivity probes when a proxy is configured. */
export function clerkJsScriptProbeUrl() {
  const base = clerkProxyProbeBase();
  if (!base) return '';
  return `${base}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
}
