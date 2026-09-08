/**
 * Helpers for passwordless email-code sign-in.
 *
 * Production Clerk enables both `email_code` and `email_link`. The prebuilt
 * `<SignIn>` often starts a magic-link wait after Continue. Magic links require
 * the same device/browser — opening the email on a phone leaves the desktop
 * stuck on "Check your email". Prefer `email_code` so users can type an OTP.
 */

import {
  ANIMA_PRODUCTION_SIGN_IN_URL,
  expireBrowserApexClerkClientUatCookies,
  isClerkAuthorizedBrowserHost,
} from "./clerkProxy";
import {
  CLERK_GITHUB_OAUTH_CALLBACK_URL,
  clerkOAuthRedirectPaths,
} from "./clerkOAuthPaths";
import { markClerkAuthReturn } from "./authBootPolicy";

export const PRODUCTION_SIGN_IN_URL = ANIMA_PRODUCTION_SIGN_IN_URL;

export { CLERK_GITHUB_OAUTH_CALLBACK_URL };

/** How long to wait for `signIn.sso()` before treating a missing redirect as a hang. */
export const GITHUB_OAUTH_SSO_TIMEOUT_MS = 10_000;

/**
 * After `sso()` resolves without a status, Clerk may still assign `window.location`
 * on the next tick. Wait this long for `pagehide` / `beforeunload` before
 * reporting a missing redirect.
 */
export const GITHUB_OAUTH_NAVIGATION_GRACE_MS = 400;

const INCOMPLETE_OAUTH_STATUSES = new Set([
  "needs_identifier",
  "needs_first_factor",
  "needs_second_factor",
  "needs_new_password",
  "needs_client_trust",
  "missing_requirements",
]);

/** @param {Array<{ strategy?: string }> | null | undefined} factors */
export function hasEmailCodeFactor(factors) {
  return (factors || []).some((factor) => factor?.strategy === "email_code");
}

/**
 * Coerce Clerk/browser values to a lowercase search string.
 * Clerk Future errors sometimes put non-strings in `message` / `code`.
 * @param {unknown} value
 */
export function asSearchText(value) {
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  if (Array.isArray(value)) {
    return value.map(asSearchText).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    const obj = /** @type {{ message?: unknown, longMessage?: unknown, long_message?: unknown, code?: unknown }} */ (
      value
    );
    const nested =
      asSearchText(obj.longMessage) ||
      asSearchText(obj.long_message) ||
      asSearchText(obj.message) ||
      asSearchText(obj.code);
    if (nested) return nested;
  }
  return "";
}

/**
 * Coerce a Clerk field into displayable text (or null).
 * @param {unknown} value
 */
export function asDisplayMessage(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const part of value) {
      const text = asDisplayMessage(part);
      if (text) return text;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = /** @type {{ longMessage?: unknown, long_message?: unknown, message?: unknown }} */ (
      value
    );
    return (
      asDisplayMessage(obj.longMessage) ||
      asDisplayMessage(obj.long_message) ||
      asDisplayMessage(obj.message)
    );
  }
  return null;
}

/** @param {string | null | undefined} [hostname] */
export function isPreviewSignInHost(hostname) {
  const host =
    hostname ||
    (typeof window !== "undefined" ? window.location.hostname : "");
  if (!host) return false;
  return !isClerkAuthorizedBrowserHost(host);
}

/**
 * Copy shown on Vercel preview hosts — OAuth + email often fail there because
 * unique deploy URLs are not registered in Clerk Paths / Deployment Protection.
 */
export function previewSignInHint() {
  return `Preview sign-in is unreliable. Use ${PRODUCTION_SIGN_IN_URL} instead.`;
}

/**
 * @param {unknown} message
 * @param {unknown} code
 */
export function isPatternFormatError(message, code) {
  const text = asSearchText(message);
  const errCode = asSearchText(code);
  return (
    errCode === "form_param_format_invalid" ||
    text.includes("did not match the expected pattern") ||
    text.includes("form_param_format_invalid")
  );
}

/**
 * Clerk single-session mode: starting a new sign-in while a session is active.
 * @param {unknown} err
 */
export function isAlreadySignedInError(err) {
  const codes = [];
  const messages = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") {
      if (typeof value === "string") messages.push(value);
      return;
    }
    const obj = /** @type {{ code?: unknown, message?: unknown, longMessage?: unknown, long_message?: unknown, errors?: unknown[] }} */ (
      value
    );
    if (obj.code != null) codes.push(asSearchText(obj.code));
    if (obj.message != null) messages.push(asSearchText(obj.message));
    if (obj.longMessage != null) messages.push(asSearchText(obj.longMessage));
    if (obj.long_message != null) messages.push(asSearchText(obj.long_message));
    if (Array.isArray(obj.errors)) obj.errors.forEach(collect);
  };
  collect(err);
  if (err instanceof Error) messages.push(asSearchText(err.message));

  if (
    codes.some(
      (code) => code === "session_exists" || code === "identifier_already_signed_in",
    )
  ) {
    return true;
  }
  const joined = messages.join(" ");
  return (
    joined.includes("already signed in") ||
    joined.includes("session already exists") ||
    joined.includes("sessions already exists")
  );
}

/**
 * Activate an existing Clerk session from a session_exists /
 * identifier_already_signed_in error, or from the client’s last active session.
 *
 * @param {{ setActive?: Function, client?: { lastActiveSessionId?: string | null, sessions?: Array<{ id?: string }> } } | null | undefined} clerk
 * @param {unknown} [err]
 * @returns {Promise<string | null>} session id when activation was attempted
 */
export async function recoverExistingClerkSession(clerk, err) {
  if (!clerk || typeof clerk.setActive !== "function") return null;

  let sessionId = null;
  const first = /** @type {{ errors?: Array<{ code?: string, meta?: { sessionId?: string, session_id?: string } }>, meta?: { sessionId?: string, session_id?: string } }} */ (
    err && typeof err === "object" ? err : null
  );
  const nested = first?.errors?.[0];
  sessionId =
    nested?.meta?.sessionId ||
    nested?.meta?.session_id ||
    first?.meta?.sessionId ||
    first?.meta?.session_id ||
    clerk.client?.lastActiveSessionId ||
    clerk.client?.sessions?.[0]?.id ||
    null;

  if (!sessionId) return null;
  await clerk.setActive({ session: sessionId });
  return sessionId;
}

/**
 * Friendlier copy when Clerk/browser reject a mistyped email pattern.
 * @param {unknown} message
 * @param {unknown} code
 */
export function humanizeIdentifierError(message, code) {
  if (isPatternFormatError(message, code)) {
    return "That email or username looks invalid. Check for typos (for example .com, not .om) and try again.";
  }
  const text = asSearchText(message);
  const errCode = asSearchText(code);
  if (
    errCode === "form_identifier_not_found" ||
    text.includes("couldn't find your account")
  ) {
    return "Couldn't find your account. Try the email or username on this Clerk account, or Continue with GitHub.";
  }
  return asDisplayMessage(message);
}

/**
 * Rewrite cryptic Clerk/browser pattern errors for the active sign-in stage.
 * @param {unknown} message
 * @param {unknown} code
 * @param {{ humanizeIdentifierFormat?: boolean, context?: 'identifier' | 'oauth' | 'code' | 'generic', previewHost?: boolean }} options
 */
function formatClerkMessage(message, code, options) {
  const {
    humanizeIdentifierFormat = false,
    context = "generic",
    previewHost = false,
  } = options;

  if (previewHost && isPatternFormatError(message, code)) {
    return previewSignInHint();
  }

  if (context === "oauth" && isPatternFormatError(message, code)) {
    return previewHost
      ? previewSignInHint()
      : `GitHub sign-in could not start (redirect URL rejected). Use ${PRODUCTION_SIGN_IN_URL}.`;
  }

  if (humanizeIdentifierFormat) {
    return humanizeIdentifierError(message, code);
  }

  // Pattern errors outside identifier create are still cryptic — never show raw.
  if (isPatternFormatError(message, code)) {
    if (context === "code") {
      return "That verification code looks invalid. Check the digits and try again.";
    }
    return previewHost
      ? previewSignInHint()
      : `Sign-in could not continue (unexpected format). Use ${PRODUCTION_SIGN_IN_URL}, or Continue with GitHub.`;
  }

  const text = asSearchText(message);
  const errCode = asSearchText(code);
  if (
    errCode === "session_exists" ||
    errCode === "identifier_already_signed_in" ||
    text.includes("already signed in") ||
    text.includes("session already exists")
  ) {
    return "You're already signed in. Opening the app…";
  }
  if (
    errCode === "form_identifier_not_found" ||
    text.includes("couldn't find your account")
  ) {
    return "Couldn't find your account. Try the email or username on this Clerk account, or Continue with GitHub.";
  }

  return asDisplayMessage(message);
}

/**
 * Pick a user-facing message from a Clerk Future `{ error }` or thrown value.
 * Never throws — Clerk error shapes are inconsistent across SDK builds.
 * @param {unknown} err
 * @param {{ humanizeIdentifierFormat?: boolean, context?: 'identifier' | 'oauth' | 'code' | 'generic', previewHost?: boolean }} [options]
 */
export function clerkErrorMessage(
  err,
  {
    humanizeIdentifierFormat = false,
    context = "generic",
    previewHost = typeof window !== "undefined"
      ? isPreviewSignInHost()
      : false,
  } = {},
) {
  const options = { humanizeIdentifierFormat, context, previewHost };
  try {
    if (!err) return null;
    if (typeof err === "string") {
      return formatClerkMessage(err, null, options);
    }
    if (err instanceof Error) {
      return formatClerkMessage(
        err.message,
        /** @type {{ code?: unknown }} */ (err).code,
        options,
      );
    }
    if (typeof err === "object") {
      const direct = /** @type {{ message?: unknown, longMessage?: unknown, code?: unknown, errors?: Array<{ code?: unknown, long_message?: unknown, message?: unknown, longMessage?: unknown }> }} */ (
        err
      );
      if (direct.longMessage != null && direct.longMessage !== "") {
        return formatClerkMessage(direct.longMessage, direct.code, options);
      }
      if (direct.message != null && direct.message !== "" && !direct.errors) {
        return formatClerkMessage(direct.message, direct.code, options);
      }
      const first = direct.errors?.[0];
      const nested =
        first?.long_message ?? first?.longMessage ?? first?.message ?? null;
      if (nested != null && nested !== "") {
        return formatClerkMessage(nested, first?.code, options);
      }
      // Last resort: stringify unknown object shapes without crashing.
      return formatClerkMessage(direct, direct.code, options);
    }
    return null;
  } catch {
    return "Couldn't start sign-in. Please try again.";
  }
}

/**
 * Operator-facing copy when GitHub OAuth never leaves this page.
 * A missing GitHub OAuth App callback often looks like a hang, not a Clerk error.
 */
export function githubOAuthHangMessage() {
  return (
    `GitHub sign-in did not redirect. Use ${PRODUCTION_SIGN_IN_URL}. ` +
    `If this keeps happening, the GitHub OAuth App must allowlist ${CLERK_GITHUB_OAUTH_CALLBACK_URL}.`
  );
}

export function githubOAuthNeedsIdentifierMessage(status) {
  const label = typeof status === "string" && status ? status : "needs_identifier";
  return (
    `GitHub sign-in did not leave this page (${label}). ` +
    `Tap Continue with GitHub again. Use ${PRODUCTION_SIGN_IN_URL}.`
  );
}

/**
 * GitHub authorize URL Clerk left on the SignIn after `sso()` / `create`.
 * clerk-js only calls `__internal_windowNavigate` when verification status is
 * `unverified` *and* this URL is set. An existing `signIn.id` without that
 * URL skips `_create` — Safari then stays on `needs_identifier` with no
 * navigation (the iPad screenshot).
 */
export function clerkOAuthProviderRedirectUrl(signIn) {
  if (!signIn || typeof signIn !== "object") return null;
  if (signIn.response && signIn.response !== signIn) {
    const nested = clerkOAuthProviderRedirectUrl(signIn.response);
    if (nested) return nested;
  }
  if (signIn.resource && signIn.resource !== signIn) {
    const nested = clerkOAuthProviderRedirectUrl(signIn.resource);
    if (nested) return nested;
  }
  if (signIn.client?.signIn && signIn.client.signIn !== signIn) {
    const nested = clerkOAuthProviderRedirectUrl(signIn.client.signIn);
    if (nested) return nested;
  }
  const verification =
    signIn.firstFactorVerification ||
    signIn.first_factor_verification ||
    signIn.verifications?.externalAccount ||
    null;
  const raw =
    verification?.externalVerificationRedirectURL ||
    verification?.externalVerificationRedirectUrl ||
    verification?.external_verification_redirect_url ||
    null;
  if (!raw) return null;
  const href =
    typeof raw === "string"
      ? raw
      : typeof raw.href === "string"
        ? raw.href
        : String(raw);
  try {
    const url = new URL(
      href,
      typeof window !== "undefined"
        ? window.location.origin
        : "https://anima-protocol.com",
    );
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com")) return url.href;
    return null;
  } catch {
    return null;
  }
}

export function assignBrowserLocation(href, assign = defaultAssignLocation) {
  if (typeof assign === "function") assign(href);
}

/**
 * clerk-js `sso()` skips `_create` when `signIn.id` exists without an OAuth
 * URL. That leftover is the iPad `needs_identifier` / no-navigation path.
 * Force a fresh `oauth_github` create (or first-party FAPI POST) instead.
 */
export function signInNeedsForcedOAuthCreate(signIn) {
  if (!signIn || typeof signIn !== "object") return false;
  if (!signIn.id) return false;
  return !clerkOAuthProviderRedirectUrl(signIn);
}

/**
 * First-party POST `/api/__clerk/v1/client/sign_ins` always mints a new
 * SignIn (does not reuse leftover `id`). Live 200 includes the GitHub
 * authorize URL. Used when Future getters hide `firstFactorVerification`.
 *
 * @param {{ origin: string, redirectCallbackUrl: string, redirectUrl: string, fetchImpl?: typeof fetch }} options
 */
export async function createGitHubOAuthViaFapi({
  origin,
  redirectCallbackUrl,
  redirectUrl,
  fetchImpl,
} = {}) {
  const base = String(origin || "").replace(/\/$/, "");
  const implicitFetch =
    !fetchImpl &&
    typeof fetch === "function" &&
    /^https:\/\/(www\.)?anima-protocol\.com$/i.test(base);
  const fetchFn = fetchImpl || (implicitFetch ? fetch : null);
  if (!fetchFn || !base || !redirectCallbackUrl) return null;
  const completePath = redirectUrl === "/" || !redirectUrl ? "/" : redirectUrl;
  try {
    const response = await fetchFn(
      `${base}/api/__clerk/v1/client/sign_ins?__clerk_api_version=2025-11-10`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          strategy: "oauth_github",
          redirect_url: `${base}${redirectCallbackUrl}`,
          action_complete_redirect_url: `${base}${completePath}`,
        }),
      },
    );
    if (!response?.ok) return null;
    const json = await response.json();
    return clerkOAuthProviderRedirectUrl(json);
  } catch {
    return null;
  }
}

function defaultAssignLocation(href) {
  if (typeof window !== "undefined" && window.location) {
    window.location.assign(href);
  }
}

/** @param {unknown} status */
export function isIncompleteOAuthSignInStatus(status) {
  if (typeof status !== "string") return false;
  return INCOMPLETE_OAUTH_STATUSES.has(status) || status.startsWith("needs_");
}

/**
 * After `signIn.sso()` returns without a Clerk error, decide whether OAuth
 * actually started a redirect, can be finalized, or is stuck mid-flow.
 *
 * @param {{ status?: string | null } | null | undefined} signIn
 * @param {{ didNavigate?: boolean }} [options]
 */
export function interpretGitHubSsoResult(signIn, { didNavigate = false } = {}) {
  if (didNavigate) {
    return { ok: true, navigated: true, shouldFinalize: false };
  }

  const status = signIn?.status ?? null;
  if (status === "complete") {
    return { ok: true, navigated: false, shouldFinalize: true, status };
  }

  if (isIncompleteOAuthSignInStatus(status)) {
    const detail =
      status === "needs_second_factor"
        ? "GitHub sign-in needs another verification step before it can finish."
        : status === "needs_client_trust"
          ? "GitHub sign-in needs to verify this device before it can finish."
          : githubOAuthNeedsIdentifierMessage(status);
    const error = new Error(
      status === "needs_second_factor" || status === "needs_client_trust"
        ? `${detail} ${githubOAuthHangMessage()}`
        : detail,
    );
    error.code = "oauth_incomplete";
    error.status = status;
    return { ok: false, navigated: false, shouldFinalize: false, status, error };
  }

  const error = new Error(githubOAuthHangMessage());
  error.code = "oauth_no_redirect";
  error.status = status;
  return { ok: false, navigated: false, shouldFinalize: false, status, error };
}

/**
 * Race `promise` against a timeout. Clerk `sso()` has no abort signal; a late
 * resolve is ignored here, but a late full-page redirect is still welcome.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {() => Error} createTimeoutError
 * @returns {Promise<T>}
 */
export function withTimeout(promise, timeoutMs, createTimeoutError) {
  let timer = 0;
  const pending = Promise.resolve(promise);
  pending.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);
  });
  return Promise.race([pending, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Wait briefly for a full-page leave after `sso()` resolves.
 * @param {() => boolean} didNavigate
 * @param {number} graceMs
 */
export function waitForPageNavigation(didNavigate, graceMs) {
  if (typeof didNavigate === "function" && didNavigate()) {
    return Promise.resolve(true);
  }
  if (!(graceMs > 0)) {
    return Promise.resolve(typeof didNavigate === "function" ? didNavigate() : false);
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(typeof didNavigate === "function" ? didNavigate() : false);
    }, graceMs);
  });
}

function createGitHubOAuthTimeoutError() {
  const error = new Error(githubOAuthHangMessage());
  error.code = "oauth_redirect_timeout";
  return error;
}

/**
 * Watch for a full-page leave while `sso()` is in flight. Clerk often assigns
 * `window.location` after the promise resolves; treat that as a successful start.
 */
export function watchPageNavigation(target = typeof window !== "undefined" ? window : null) {
  let navigated = false;
  const mark = () => {
    navigated = true;
  };
  if (target?.addEventListener) {
    target.addEventListener("pagehide", mark);
    target.addEventListener("beforeunload", mark);
  }
  return {
    didNavigate: () => navigated,
    dispose() {
      if (target?.removeEventListener) {
        target.removeEventListener("pagehide", mark);
        target.removeEventListener("beforeunload", mark);
      }
    },
  };
}

/**
 * Start GitHub OAuth using Clerk's Future `signIn.sso()` API.
 *
 * `clerk.authenticateWithRedirect` is not on the LoadedClerk object in
 * @clerk/react v6 — calling it throws "authenticateWithRedirect is not a function".
 *
 * Times out if `sso()` never navigates (hang / missing GitHub OAuth callback).
 * After a successful return with no navigation, incomplete `needs_*` statuses
 * become an actionable error instead of leaving the button spinning.
 *
 * @param {{ sso?: Function, authenticateWithRedirect?: Function, status?: string | null } | null | undefined} signIn
 * @param {string} basePath
 * @param {{ authenticateWithRedirect?: Function, client?: { signIn?: { authenticateWithRedirect?: Function } } } | null | undefined} [clerk]
 * @param {{ timeoutMs?: number, navigationGraceMs?: number, didNavigate?: () => boolean, expireApexUat?: () => void, assignLocation?: (href: string) => void, origin?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function startGitHubOAuthSignIn(signIn, basePath, clerk, options = {}) {
  const expireApexUat =
    options.expireApexUat ?? expireBrowserApexClerkClientUatCookies;
  expireApexUat();
  markClerkAuthReturn();
  const paths = clerkOAuthRedirectPaths(basePath, "sign-in");
  const timeoutMs = options.timeoutMs ?? GITHUB_OAUTH_SSO_TIMEOUT_MS;
  const navigationGraceMs = options.navigationGraceMs ?? GITHUB_OAUTH_NAVIGATION_GRACE_MS;
  const assignLocation = options.assignLocation;
  const origin =
    options.origin ||
    (typeof window !== "undefined" ? window.location.origin : "https://anima-protocol.com");
  const watcher = options.didNavigate
    ? { didNavigate: () => Boolean(options.didNavigate()), dispose() {} }
    : watchPageNavigation();

  const navigateToProviderIfNeeded = async () => {
    if (watcher.didNavigate()) return true;
    let href =
      clerkOAuthProviderRedirectUrl(signIn) || clerkOAuthProviderRedirectUrl(clerk);
    if (!href && typeof signIn?.create === "function") {
      const completePath = paths.redirectUrl === "/" ? "/" : paths.redirectUrl;
      await signIn.create({
        strategy: "oauth_github",
        redirectUrl: `${origin.replace(/\/$/, "")}${paths.redirectCallbackUrl}`,
        actionCompleteRedirectUrl: `${origin.replace(/\/$/, "")}${completePath}`,
      });
      href =
        clerkOAuthProviderRedirectUrl(signIn) || clerkOAuthProviderRedirectUrl(clerk);
    }
    if (!href) {
      href = await createGitHubOAuthViaFapi({
        origin,
        redirectCallbackUrl: paths.redirectCallbackUrl,
        redirectUrl: paths.redirectUrl,
        fetchImpl: options.fetchImpl,
      });
    }
    if (!href) return false;
    assignBrowserLocation(href, assignLocation ?? defaultAssignLocation);
    return true;
  };

  const finishOAuth = async (method) => {
    let interpreted = interpretGitHubSsoResult(signIn, {
      didNavigate: watcher.didNavigate(),
    });
    if (!interpreted.ok && interpreted.error?.code === "oauth_no_redirect") {
      const navigated = await waitForPageNavigation(watcher.didNavigate, navigationGraceMs);
      interpreted = interpretGitHubSsoResult(signIn, { didNavigate: navigated });
    }
    if (
      !interpreted.ok &&
      (interpreted.error?.code === "oauth_no_redirect" ||
        interpreted.status === "needs_identifier" ||
        interpreted.status === "needs_first_factor")
    ) {
      const assigned = await navigateToProviderIfNeeded();
      if (assigned) {
        return { method, ...paths, ok: true, navigated: true, shouldFinalize: false };
      }
    }
    if (!interpreted.ok) {
      throw interpreted.error;
    }
    return { method, ...paths, ...interpreted };
  };

  try {
    if (signInNeedsForcedOAuthCreate(signIn)) {
      const assigned = await navigateToProviderIfNeeded();
      if (assigned) {
        return {
          method: "oauth_github.create",
          ...paths,
          ok: true,
          navigated: true,
          shouldFinalize: false,
        };
      }
    }

    if (signIn && typeof signIn.sso === "function") {
      const { error } = await withTimeout(
        signIn.sso({
          strategy: "oauth_github",
          redirectCallbackUrl: paths.redirectCallbackUrl,
          redirectUrl: paths.redirectUrl,
        }),
        timeoutMs,
        createGitHubOAuthTimeoutError,
      );
      if (error) {
        throw error;
      }
      return await finishOAuth("signIn.sso");
    }

      // Legacy fallbacks for older clerk-js builds still exposing redirect helpers.
      const legacy =
        (signIn && typeof signIn.authenticateWithRedirect === "function"
          ? signIn.authenticateWithRedirect.bind(signIn)
          : null) ||
        (clerk?.client?.signIn &&
        typeof clerk.client.signIn.authenticateWithRedirect === "function"
          ? clerk.client.signIn.authenticateWithRedirect.bind(clerk.client.signIn)
          : null) ||
        (clerk && typeof clerk.authenticateWithRedirect === "function"
          ? clerk.authenticateWithRedirect.bind(clerk)
          : null);

      if (legacy) {
        await withTimeout(
          Promise.resolve(
            legacy({
              strategy: "oauth_github",
              redirectUrl: paths.redirectCallbackUrl,
              redirectUrlComplete: paths.redirectUrl,
            }),
          ),
          timeoutMs,
          createGitHubOAuthTimeoutError,
        );
        return await finishOAuth("authenticateWithRedirect");
      }

      throw new Error(
        `GitHub sign-in is unavailable in this Clerk SDK build. Refresh and try again, or use an email code on ${PRODUCTION_SIGN_IN_URL}.`,
      );
    } finally {
      watcher.dispose();
    }
}
