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
  return raw;
}
