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
