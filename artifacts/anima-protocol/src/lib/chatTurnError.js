const GENERIC_PROVIDER_RETURNED_RE = /(?:\b\d{3}\s+)?provider returned error/i;
const OPENROUTER_ZDR_DUMP_RE =
  /zdr violation|guardrail restrictions|0 endpoints out of/i;

const OPENROUTER_ZDR_PRIVACY_HINT =
  "OpenRouter blocked this model because of your account's Zero Data Retention (ZDR) settings. " +
  "Allow the model (or turn off ZDR) at https://openrouter.ai/settings/privacy.";

/**
 * Map a failed chat turn into copy that is safe to show in the HUD.
 * Engine / bundler errors (TDZ, missing bindings) must not leak minified names.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function chatTurnErrorMessage(err) {
  const raw = err instanceof Error && err.message ? String(err.message).trim() : "";
  const isEngineError =
    err instanceof ReferenceError ||
    err instanceof TypeError ||
    /before initialization|is not defined|is not a function|Cannot read propert/i.test(
      raw,
    );
  if (!raw || isEngineError) {
    return "The companion could not reply. Please try again.";
  }
  // OpenRouter's multi-line ZDR / guardrail dump must never become the toast.
  if (OPENROUTER_ZDR_DUMP_RE.test(raw)) {
    return OPENROUTER_ZDR_PRIVACY_HINT;
  }
  // OpenRouter's opaque GMICloud wrapper must never become the chat toast.
  if (GENERIC_PROVIDER_RETURNED_RE.test(raw)) {
    return (
      "The OpenRouter free-tier model is temporarily unavailable. " +
      "Retry shortly, or add credits at https://openrouter.ai/settings/credits for paid models."
    );
  }
  return raw;
}
