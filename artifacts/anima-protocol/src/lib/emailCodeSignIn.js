/**
 * Helpers for passwordless email-code sign-in.
 *
 * Production Clerk enables both `email_code` and `email_link`. The prebuilt
 * `<SignIn>` often starts a magic-link wait after Continue. Magic links require
 * the same device/browser — opening the email on a phone leaves the desktop
 * stuck on "Check your email". Prefer `email_code` so users can type an OTP.
 */

import { clerkOAuthRedirectPaths } from "./clerkOAuthPaths";

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

/**
 * Friendlier copy when Clerk/browser reject a mistyped email pattern.
 * @param {unknown} message
 * @param {unknown} code
 */
export function humanizeIdentifierError(message, code) {
  const text = asSearchText(message);
  const errCode = asSearchText(code);
  const isIdentifierFormatError = errCode === "form_param_format_invalid";
  if (
    isIdentifierFormatError ||
    (!errCode &&
      (text.includes("did not match the expected pattern") ||
        text.includes("is invalid") ||
        text.includes("invalid email")))
  ) {
    return "That email or username looks invalid. Check for typos (for example .com, not .om) and try again.";
  }
  return asDisplayMessage(message);
}

/**
 * Pick a user-facing message from a Clerk Future `{ error }` or thrown value.
 * Never throws — Clerk error shapes are inconsistent across SDK builds.
 * @param {unknown} err
 */
export function clerkErrorMessage(err) {
  try {
    if (!err) return null;
    if (typeof err === "string") return humanizeIdentifierError(err, null);
    if (err instanceof Error) {
      return humanizeIdentifierError(err.message, /** @type {{ code?: unknown }} */ (err).code);
    }
    if (typeof err === "object") {
      const direct = /** @type {{ message?: unknown, longMessage?: unknown, code?: unknown, errors?: Array<{ code?: unknown, long_message?: unknown, message?: unknown, longMessage?: unknown }> }} */ (
        err
      );
      if (direct.longMessage != null && direct.longMessage !== "") {
        return (
          humanizeIdentifierError(direct.longMessage, direct.code) ||
          asDisplayMessage(direct.longMessage)
        );
      }
      if (direct.message != null && direct.message !== "" && !direct.errors) {
        return (
          humanizeIdentifierError(direct.message, direct.code) ||
          asDisplayMessage(direct.message)
        );
      }
      const first = direct.errors?.[0];
      const nested =
        first?.long_message ?? first?.longMessage ?? first?.message ?? null;
      if (nested != null && nested !== "") {
        return humanizeIdentifierError(nested, first?.code) || asDisplayMessage(nested);
      }
      // Last resort: stringify unknown object shapes without crashing.
      return humanizeIdentifierError(direct, direct.code);
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
    "GitHub sign-in is unavailable in this Clerk SDK build. Refresh and try again, or use an email code on https://www.anima-protocol.com/sign-in.",
  );
}
