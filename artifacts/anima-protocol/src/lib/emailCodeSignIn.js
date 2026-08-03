/**
 * Helpers for passwordless email-code sign-in.
 *
 * Production Clerk enables both `email_code` and `email_link`. The prebuilt
 * `<SignIn>` often starts a magic-link wait after Continue. Magic links require
 * the same device/browser — opening the email on a phone leaves the desktop
 * stuck on "Check your email". Prefer `email_code` so users can type an OTP.
 */

/** @param {Array<{ strategy?: string }> | null | undefined} factors */
export function hasEmailCodeFactor(factors) {
  return (factors || []).some((factor) => factor?.strategy === "email_code");
}

/**
 * Pick a user-facing message from a Clerk Future `{ error }` or thrown value.
 * @param {unknown} err
 */
export function clerkErrorMessage(err) {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const direct = /** @type {{ message?: string, longMessage?: string, errors?: Array<{ long_message?: string, message?: string, longMessage?: string }> }} */ (
      err
    );
    if (direct.longMessage) return direct.longMessage;
    if (direct.message && !direct.errors) return direct.message;
    const first = direct.errors?.[0];
    if (first?.long_message) return first.long_message;
    if (first?.longMessage) return first.longMessage;
    if (first?.message) return first.message;
  }
  return null;
}
