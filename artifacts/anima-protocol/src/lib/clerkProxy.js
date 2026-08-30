/**
 * Clerk Frontend API proxy URL helpers.
 *
 * Clerk requires proxyUrl to end with a trailing slash and to match the Proxy URL
 * configured in the Clerk dashboard exactly (production uses www.anima-protocol.com).
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

/**
 * Decodes the frontend API host embedded in a Clerk publishable key.
 */
export function decodeClerkFrontendHost(clerkPubKey) {
  if (typeof clerkPubKey !== 'string') return '';
  const match = clerkPubKey.match(/^pk_(?:live|test)_(.+)$/);
  if (!match) return '';
  try {
    const rawPayload = match[1].replace(/\$$/, '');
    const decoded =
      typeof window !== 'undefined' && typeof window.atob === 'function'
        ? window.atob(rawPayload)
        : typeof atob === 'function'
          ? atob(rawPayload)
          : typeof Buffer !== 'undefined'
            ? Buffer.from(rawPayload, 'base64').toString('utf-8')
            : '';
    return decoded.replace(/\$$/, '').trim();
  } catch {
    return '';
  }
}

/**
 * Returns true if the publishable key points to a Clerk custom domain (e.g. clerk.anima-protocol.com).
 */
export function publishableKeyUsesCustomDomain(clerkPubKey) {
  const host = decodeClerkFrontendHost(clerkPubKey);
  if (!host) return false;
  return !host.endsWith('.clerk.accounts.dev') && !host.endsWith('.accounts.dev');
}

/**
 * Base URL of the Frontend API host (e.g. https://clerk.anima-protocol.com).
 */
export function clerkFrontendApiProbeBase(clerkPubKey) {
  const host = decodeClerkFrontendHost(clerkPubKey);
  if (host) return `https://${host}`;
  return '';
}

/**
 * Absolute OAuth complete callback URL.
 */
export function clerkProviderOAuthCallbackUrl() {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/sso-callback`;
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
 * If a custom domain is detected (e.g. clerk.anima-protocol.com), proxy is skipped unless explicitly configured.
 */
export function shouldUseClerkProxy(clerkPubKey) {
  if (isClerkProxyExplicitlyDisabled()) return false;
  if (configuredClerkProxyUrl()) return true;
  if (typeof clerkPubKey !== 'string' || !clerkPubKey.startsWith('pk_live_')) {
    return false;
  }
  if (publishableKeyUsesCustomDomain(clerkPubKey)) {
    return false;
  }
  if (typeof window === 'undefined') return false;

  const host = window.location.hostname;
  if (import.meta.env.DEV && isLocalDevHostname(host)) return true;
  if (
    import.meta.env.PROD &&
    isAnimaProductionHost(host)
  ) {
    return true;
  }
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
  if (proxy) {
    if (proxy.startsWith('/') && typeof window !== 'undefined') {
      return `${window.location.origin}${proxy.replace(/\/$/, '')}`;
    }
    return proxy.replace(/\/$/, '');
  }
  const customBase = clerkFrontendApiProbeBase(clerkPubKey);
  if (customBase) {
    return customBase;
  }
  return '';
}

/** clerk-js bundle path for connectivity probes (proxy or custom Clerk domain). */
export function clerkJsScriptProbeUrl(clerkPubKey) {
  const base = clerkProxyProbeBase(clerkPubKey);
  if (!base) return '';
  return `${base}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
}
