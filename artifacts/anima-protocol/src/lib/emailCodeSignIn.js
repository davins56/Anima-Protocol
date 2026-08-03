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
 * Friendlier copy when Clerk/browser reject a mistyped email pattern.
 * @param {string | null | undefined} message
 * @param {string | null | undefined} code
 */
export function humanizeIdentifierError(message, code) {
  const text = (message || "").toLowerCase();
  const errCode = (code || "").toLowerCase();
  if (
    errCode.includes("format") ||
    errCode.includes("param") ||
    text.includes("did not match the expected pattern") ||
    text.includes("is invalid") ||
    text.includes("invalid email")
  ) {
    return "That email or username looks invalid. Check for typos (for example .com, not .om) and try again.";
  }
  return message || null;
}

/**
 * Pick a user-facing message from a Clerk Future `{ error }` or thrown value.
 * @param {unknown} err
 */
export function clerkErrorMessage(err) {
  if (!err) return null;
  if (typeof err === "string") return humanizeIdentifierError(err, null);
  if (typeof err === "object") {
    const direct = /** @type {{ message?: string, longMessage?: string, code?: string, errors?: Array<{ code?: string, long_message?: string, message?: string, longMessage?: string }> }} */ (
      err
    );
    if (direct.longMessage) {
      return humanizeIdentifierError(direct.longMessage, direct.code) || direct.longMessage;
    }
    if (direct.message && !direct.errors) {
      return humanizeIdentifierError(direct.message, direct.code) || direct.message;
    }
    const first = direct.errors?.[0];
    const nested =
      first?.long_message || first?.longMessage || first?.message || null;
    if (nested) {
      return humanizeIdentifierError(nested, first?.code) || nested;
    }
  }
  return null;
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
