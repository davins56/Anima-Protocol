// @ts-check
/**
 * Heat meter value on the client. Mirrors api-server lib/heatIntensity.ts:
 * the meter shows sensual heat or right-now intensity, whichever is higher,
 * and intensity halves every INTENSITY_HALF_LIFE_MINUTES of quiet (whole
 * minutes), so the bar cools during a pause without a reload.
 */

export const INTENSITY_HALF_LIFE_MINUTES = 6;

function clamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

/**
 * @param {number} value
 * @param {number} idleMinutes
 */
export function coolIntensity(value, idleMinutes) {
  const v = clamp(value);
  const minutes = Math.floor(Math.max(0, Number(idleMinutes) || 0));
  if (minutes <= 0 || v <= 0) return Math.round(v);
  const cooled = v * Math.pow(0.5, minutes / INTENSITY_HALF_LIFE_MINUTES);
  return cooled < 1 ? 0 : Math.round(cooled);
}

/**
 * What the Heat meter shows for a stored profile at `now`.
 *
 * @param {{ heat?: number, intensity?: number, intensityAt?: string, display_heat?: number } | null | undefined} profile
 * @param {number} [now]
 */
export function meterHeat(profile, now = Date.now()) {
  if (!profile) return 0;
  const heat = Math.round(clamp(profile.heat));
  const at = profile.intensityAt ? Date.parse(profile.intensityAt) : NaN;
  const intensity = Number.isFinite(at)
    ? coolIntensity(Number(profile.intensity) || 0, (now - at) / 60_000)
    : Math.round(clamp(profile.intensity));
  return Math.max(heat, intensity);
}

/**
 * A value a reply just reported, cooled for the time since it arrived.
 *
 * @param {{ value: number, at: number } | null | undefined} live
 * @param {number} [now]
 */
export function liveHeatNow(live, now = Date.now()) {
  if (!live || typeof live.value !== "number" || !Number.isFinite(live.value)) return 0;
  return coolIntensity(live.value, (now - live.at) / 60_000);
}
