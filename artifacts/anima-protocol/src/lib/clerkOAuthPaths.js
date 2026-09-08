/**
 * Relative paths for Clerk `signIn.sso()` — must be same-origin paths, not absolute
 * URLs. Absolute URLs trigger Clerk validation errors ("did not match the expected
 * pattern") and break the OAuth redirect.
 *
 * @see https://clerk.com/docs/guides/development/custom-flows/authentication/oauth-connections
 */

export function joinBasePath(basePath, segment) {
  const base = (basePath || '').replace(/\/$/, '');
  const path = segment.startsWith('/') ? segment : `/${segment}`;
  if (!base) return path;
  return `${base}${path}`;
}

/** SSO callback route that matches our React Router handlers. */
export function clerkSsoCallbackPath(basePath, mode = 'sign-in') {
  const segment = mode === 'sign-up' ? 'sign-up' : 'sign-in';
  return joinBasePath(basePath, `${segment}/sso-callback`);
}

/** Post-auth landing path after OAuth completes without extra steps. */
export function clerkOAuthCompletePath(basePath) {
  if (!basePath) return '/';
  const path = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return path || '/';
}

/**
 * Clerk Frontend API / Account Portal hosts. After sign-in, decorateUrl /
 * dashboard after_sign_in_url can send the browser here (empty JSON), which
 * consumes the handshake and looks like "login bounced back".
 */
export function isClerkOwnedHostname(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/:\d+$/, '');
  if (!host) return false;
  return (
    host === 'clerk.anima-protocol.com' ||
    host === 'accounts.anima-protocol.com' ||
    host === 'frontend-api.clerk.dev' ||
    host.endsWith('.clerk.accounts.dev') ||
    host.endsWith('.accounts.dev') ||
    host.endsWith('.clerk.services') ||
    host.endsWith('.clerkprod-cloudflare.net')
  );
}

/** Query keys Clerk uses to finish OAuth / satellite handshake on the app origin. */
export const CLERK_HANDSHAKE_QUERY_KEYS = [
  '__clerk_handshake',
  '__clerk_handshake_nonce',
  '__clerk_status',
  '__clerk_created_session',
  '__clerk_synced',
];

export function isClerkFrontendApiPath(pathname) {
  const path = String(pathname || '');
  return (
    path === '/v1' ||
    path.startsWith('/v1/') ||
    path === '/npm' ||
    path.startsWith('/npm/')
  );
}

export function isClerkSsoCallbackPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  return (
    path === '/sso-callback' ||
    path.endsWith('/sso-callback') ||
    path.includes('/sign-in/sso-callback') ||
    path.includes('/sign-up/sso-callback')
  );
}

export function clerkHandshakeSearch(search) {
  const raw = String(search || '');
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const kept = new URLSearchParams();
  for (const key of CLERK_HANDSHAKE_QUERY_KEYS) {
    if (params.has(key)) kept.set(key, params.get(key) ?? '');
  }
  const serialized = kept.toString();
  return serialized ? `?${serialized}` : '';
}

/** Handshake tokens still in the URL — ClerkProvider / HandleSSOCallback need them. */
export function hasClerkHandshakeQuery({ search = '', hash = '' } = {}) {
  const hashQuery = String(hash || '').replace(/^#/, '');
  return Boolean(clerkHandshakeSearch(search) || clerkHandshakeSearch(hashQuery));
}

/**
 * True while Clerk still needs this navigation to finish a session transfer
 * (SSO callback route or `__clerk_*` query).
 */
export function hasPendingClerkHandshake({
  search = '',
  pathname = '',
  hash = '',
} = {}) {
  if (isClerkSsoCallbackPath(pathname)) return true;
  return hasClerkHandshakeQuery({ search, hash });
}

function isKnownAppReturnPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  if (isClerkSsoCallbackPath(path)) return true;
  if (path === '/sign-in' || path.startsWith('/sign-in/')) return true;
  if (path === '/sign-up' || path.startsWith('/sign-up/')) return true;
  return false;
}

function appPathWithHandshake(pathname, search, hash, fallbackPath) {
  const fallback = fallbackPath || '/';
  const path = isKnownAppReturnPath(pathname) ? pathname : fallback;
  return `${path}${clerkHandshakeSearch(search)}${hash || ''}`;
}

/**
 * Keep the user on the SPA after Clerk setActive / HandleSSOCallback.
 * Relative paths and same-origin (or anima production) URLs stay in-app.
 * Clerk FAPI hosts are rewritten to fallbackPath, keeping handshake query.
 *
 * @returns {{ mode: 'in-app', path: string } | { mode: 'external', href: string }}
 */
export function resolvePostAuthNavigation(
  destination,
  {
    fallbackPath = '/',
    origin = typeof window !== 'undefined' ? window.location.origin : '',
  } = {},
) {
  const fallback = fallbackPath || '/';
  if (typeof destination !== 'string' || !destination) {
    return { mode: 'in-app', path: fallback };
  }
  if (!/^https?:\/\//i.test(destination)) {
    return { mode: 'in-app', path: destination };
  }
  let url;
  try {
    url = new URL(destination);
  } catch {
    return { mode: 'in-app', path: fallback };
  }
  if (isClerkOwnedHostname(url.hostname)) {
    return {
      mode: 'in-app',
      path: appPathWithHandshake(url.pathname, url.search, url.hash, fallback),
    };
  }
  const destOrigin = url.origin;
  if (origin && destOrigin === origin) {
    return { mode: 'in-app', path: `${url.pathname}${url.search}${url.hash}` || fallback };
  }
  const host = url.hostname.toLowerCase().replace(/:\d+$/, '');
  if (
    host === 'anima-protocol.com' ||
    host === 'www.anima-protocol.com' ||
    host.endsWith('.anima-protocol.com')
  ) {
    if (isClerkOwnedHostname(host)) {
      return { mode: 'in-app', path: fallback };
    }
    return { mode: 'in-app', path: `${url.pathname}${url.search}${url.hash}` || fallback };
  }
  return { mode: 'external', href: url.href };
}

/**
 * Apply Clerk's decorateUrl / currentTask rules, then pin the result to the app.
 */
export function destinationAfterClerkAuth({
  session,
  decorateUrl,
  fallbackPath = '/',
  origin,
} = {}) {
  const decorate =
    typeof decorateUrl === 'function' ? decorateUrl : (value) => value;
  const raw = session?.currentTask
    ? decorate(`/${session.currentTask.key}`)
    : decorate(fallbackPath);
  return resolvePostAuthNavigation(raw, { fallbackPath, origin });
}

/**
 * Params for `signIn.sso()` — relative paths only.
 */
export function clerkOAuthRedirectPaths(basePath, mode = 'sign-in') {
  return {
    redirectCallbackUrl: clerkSsoCallbackPath(basePath, mode),
    redirectUrl: clerkOAuthCompletePath(basePath),
  };
}

/** Absolute callback URL for Clerk Dashboard → Redirect URLs hints. */
export function clerkOAuthCallbackAbsolute(origin, basePath, mode = 'sign-in') {
  const path = clerkSsoCallbackPath(basePath, mode);
  return `${origin}${path}`;
}

/**
 * GitHub (and other) OAuth apps must allowlist Clerk's custom-domain callback,
 * not the SPA `/sign-in/sso-callback` path. A mismatch often looks like
 * `signIn.sso()` hanging with no redirect.
 */
export const CLERK_GITHUB_OAUTH_CALLBACK_URL =
  'https://clerk.anima-protocol.com/v1/oauth_callback';

/**
 * True when the browser just came back from GitHub or Clerk FAPI.
 * Used so leftover Instant Sandbox cannot paint Home after OAuth.
 */
export function isClerkOAuthReferrer(referrer) {
  const raw = String(referrer || '').trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/:\d+$/, '');
    if (host === 'github.com' || host.endsWith('.github.com')) return true;
    return isClerkOwnedHostname(host);
  } catch {
    return false;
  }
}
