/**
 * Map a failed chat turn into copy that is safe to show in the HUD.
 * Engine / bundler errors (TDZ, missing bindings) must not leak minified names.
 *
 * @param {unknown} err
 * @returns {string}
 */
const GENERIC_PROVIDER_RETURNED_RE = /(?:\b\d{3}\s+)?provider returned error/i;

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
  // OpenRouter's opaque GMICloud wrapper must never become the chat toast.
  if (GENERIC_PROVIDER_RETURNED_RE.test(raw)) {
    return (
      "The OpenRouter free-tier model is temporarily unavailable. " +
      "Retry shortly, or add credits at https://openrouter.ai/settings/credits for paid models."
    );
  }
  return raw;
}
