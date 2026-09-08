/**
 * Clerk Frontend API proxy URL helpers.
 *
 * Clerk requires proxyUrl to end with a trailing slash. Production users are
 * on anima-protocol.com (www 301s there). The same-origin proxy is
 * `/api/__clerk/` so Clerk session cookies are first-party.
 */

export const ANIMA_APEX_HOST = 'anima-protocol.com';
/** Apex origin — Cloudflare serves production here. www 301s here with path kept. */
export const ANIMA_PRODUCTION_ORIGIN = `https://${ANIMA_APEX_HOST}`;

/**
 * Canonical sign-in URL. Prefer apex. Production www is a Cloudflare zone
 * Redirect Rule that currently drops the path — see
 * scripts/cloudflare/www-redirect.md. After that rule keeps `${1}`, www
 * `/sign-in` 301s to apex `/sign-in`, never `/`.
 */
export const ANIMA_PRODUCTION_SIGN_IN_URL = `${ANIMA_PRODUCTION_ORIGIN}/sign-in`;

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

/**
 * Hosts allowed to talk to the production Clerk FAPI (clerk.anima-protocol.com).
 * Any other browser origin gets origin_invalid on /v1/client.
 */
export function isClerkAuthorizedBrowserHost(hostname) {
  const host = (hostname || '').toLowerCase().replace(/:\d+$/, '');
  return isAnimaProductionHost(host) || isLocalDevHostname(host);
}

export function ensureTrailingSlash(url) {
  if (!url) return '';
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * DNS hostname: letters, digits, hyphens, and dots. Rejects mojibake from
 * base64-decoding placeholders like `pk_test_placeholder`.
 */
const CLERK_FRONTEND_HOST_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

function asClerkFrontendHostname(decoded) {
  const host = decoded.replace(/\$$/, '').trim();
  return CLERK_FRONTEND_HOST_RE.test(host) ? host : '';
}

/**
 * Decodes the frontend API host embedded in a Clerk publishable key.
 * Returns "" unless the payload decodes to a hostname (never mojibake).
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
    return asClerkFrontendHostname(decoded);
  } catch {
    return '';
  }
}

/**
 * True when the key is a real pk_live_/pk_test_ whose payload decodes to a host.
 * `pk_test_placeholder` and any other non-hostname payload are treated as unset.
 */
export function isUsableClerkPublishableKey(clerkPubKey) {
  if (typeof clerkPubKey !== 'string') return false;
  const key = clerkPubKey.trim();
  if (!key || /placeholder/i.test(key)) return false;
  if (!/^pk_(?:live|test)_/.test(key)) return false;
  return Boolean(decodeClerkFrontendHost(key));
}

/** Returns the key, or "" when it must not be baked into a production build. */
export function sanitizeClerkPublishableKey(clerkPubKey) {
  if (typeof clerkPubKey !== 'string') return '';
  const key = clerkPubKey.trim();
  return isUsableClerkPublishableKey(key) ? key : '';
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
 * Absolute proxy URL advertised to Clerk (apex — www 301s here).
 */
export function animaProductionClerkProxyUrl() {
  return `${ANIMA_PRODUCTION_ORIGIN}/api/__clerk/`;
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
 * Production anima hosts + pk_live_ must keep Clerk FAPI on `/api/__clerk`.
 *
 * clerk-js buildUrl: if `proxyUrl` is set, XHR goes to
 * `{origin}/api/__clerk/v1/…`. If `proxyUrl` is omitted, production uses
 * `https://${frontendApi}` from the publishable key — for us that is
 * `https://clerk.anima-protocol.com/v1/…` and #405's Worker cookie strip
 * never runs. AGENTS.md used to describe that direct-CNAME path as the
 * default for custom-domain keys; that contradicts Safari ITP first-party
 * cookies and is the post-GitHub authorization_invalid path.
 */
export function mustUseSameOriginClerkProxy(
  clerkPubKey,
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
) {
  if (typeof clerkPubKey !== 'string' || !clerkPubKey.startsWith('pk_live_')) {
    return false;
  }
  return isAnimaProductionHost(hostname);
}

/** False on production custom-domain keys — never remount ClerkProvider without proxyUrl. */
export function shouldAllowDirectClerkFallback(
  clerkPubKey,
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
) {
  return !mustUseSameOriginClerkProxy(clerkPubKey, hostname);
}

/**
 * Whether pk_live_ should route Clerk FAPI through the same-origin proxy.
 *
 * Custom-domain keys (clerk.anima-protocol.com) still use the proxy on
 * anima-protocol.com. That host CNAMEs to Clerk infrastructure; Safari ITP
 * treats those cookies as third-party, so a direct FAPI session never sticks.
 */
export function shouldUseClerkProxy(clerkPubKey) {
  if (mustUseSameOriginClerkProxy(clerkPubKey)) return true;
  if (isClerkProxyExplicitlyDisabled()) return false;
  if (configuredClerkProxyUrl()) return true;
  if (typeof clerkPubKey !== 'string' || !clerkPubKey.startsWith('pk_live_')) {
    return false;
  }
  if (typeof window === 'undefined') return false;

  const host = window.location.hostname;
  if (import.meta.env.DEV && isLocalDevHostname(host)) return true;
  return false;
}

/**
 * Resolved proxy URL for ClerkProvider, or "" when Clerk should talk directly.
 */
export function resolveClerkProxyUrl(clerkPubKey) {
  if (mustUseSameOriginClerkProxy(clerkPubKey)) {
    return configuredClerkProxyUrl() || clerkProviderProxyPath();
  }
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

/** Clerk client/session cookies, including `__client_uat*`. */
export function isBrowserClerkAuthCookieName(name) {
  const n = String(name || '').trim().toLowerCase();
  return (
    n.startsWith('__client') ||
    n.startsWith('__session') ||
    n.startsWith('__refresh')
  );
}

/**
 * Expire Domain=apex Clerk auth cookies (`__client*`, `__session*`, `__refresh*`).
 *
 * `__client_uat*` is not HttpOnly, so GitHub's hop to
 * clerk.anima-protocol.com/v1/oauth_callback sends Domain=apex copies and
 * Clerk returns authorization_invalid. Host-only copies (no Domain) stay on
 * the app origin. HttpOnly leftovers are expired by the Worker on the next
 * `/api/__clerk` response — JS cannot delete those. clerk.anima-protocol.com
 * host-only cookies are not visible from this origin.
 */
export function expireBrowserApexClerkClientUatCookies({
  cookie = typeof document !== 'undefined' ? document.cookie : '',
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
  writeCookie,
} = {}) {
  if (!isAnimaProductionHost(hostname)) return [];
  const names = new Set(['__client_uat']);
  for (const part of String(cookie || '').split(';')) {
    const name = part.trim().split('=')[0] || '';
    if (isBrowserClerkAuthCookieName(name)) names.add(name);
  }
  const writer =
    writeCookie ||
    ((value) => {
      if (typeof document !== 'undefined') document.cookie = value;
    });
  const written = [];
  const domains = [ANIMA_APEX_HOST, `.${ANIMA_APEX_HOST}`];
  for (const name of names) {
    for (const domain of domains) {
      const expiry = `${name}=; Path=/; Domain=${domain}; Max-Age=0; Secure; SameSite=Lax`;
      writer(expiry);
      written.push(expiry);
    }
  }
  return written;
}
