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

/**
 * Keep the user on the SPA after Clerk setActive / HandleSSOCallback.
 * Relative paths and same-origin (or anima production) URLs stay in-app.
 * Clerk FAPI hosts are rewritten to fallbackPath.
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
    return { mode: 'in-app', path: fallback };
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
