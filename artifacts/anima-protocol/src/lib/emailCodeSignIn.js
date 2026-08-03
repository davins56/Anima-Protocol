/**
 * Helpers for passwordless email-code sign-in.
 *
 * Production Clerk enables both `email_code` and `email_link`. The prebuilt
 * `<SignIn>` often starts a magic-link wait after Continue. Magic links require
 * the same device/browser — opening the email on a phone leaves the desktop
 * stuck on "Check your email". Prefer `email_code` so users can type an OTP.
 */

import { isVercelPreviewHost } from "./clerkProxy";
import { clerkOAuthRedirectPaths } from "./clerkOAuthPaths";

export const PRODUCTION_SIGN_IN_URL = "https://www.anima-protocol.com/sign-in";

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
  if (hostname) return isVercelPreviewHost(hostname);
  if (typeof window === "undefined") return false;
  return isVercelPreviewHost(window.location.hostname);
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
 * Start GitHub OAuth using Clerk's Future `signIn.sso()` API.
 *
 * `clerk.authenticateWithRedirect` is not on the LoadedClerk object in
 * @clerk/react v6 — calling it throws "authenticateWithRedirect is not a function".
 *
 * @param {{ sso?: Function, authenticateWithRedirect?: Function } | null | undefined} signIn
 * @param {string} basePath
 * @param {{ authenticateWithRedirect?: Function, client?: { signIn?: { authenticateWithRedirect?: Function } } } | null | undefined} [clerk]
 */
export async function startGitHubOAuthSignIn(signIn, basePath, clerk) {
  const paths = clerkOAuthRedirectPaths(basePath, "sign-in");

  if (signIn && typeof signIn.sso === "function") {
    const { error } = await signIn.sso({
      strategy: "oauth_github",
      redirectCallbackUrl: paths.redirectCallbackUrl,
      redirectUrl: paths.redirectUrl,
    });
    if (error) {
      throw error;
    }
    return { method: "signIn.sso", ...paths };
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
    await legacy({
      strategy: "oauth_github",
      redirectUrl: paths.redirectCallbackUrl,
      redirectUrlComplete: paths.redirectUrl,
    });
    return { method: "authenticateWithRedirect", ...paths };
  }

  throw new Error(
    `GitHub sign-in is unavailable in this Clerk SDK build. Refresh and try again, or use an email code on ${PRODUCTION_SIGN_IN_URL}.`,
  );
}
