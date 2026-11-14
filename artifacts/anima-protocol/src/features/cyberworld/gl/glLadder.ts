/**
 * Robust WebGL bring-up for the cyberworld (pure, unit-tested).
 *
 * Root cause this guards against: the R3F renderer's own getContext("webgl2",
 * {antialias, powerPreference: "high-performance", …}) can return null on iPad
 * Safari even though a plain probe succeeds (live-context budget, attributes,
 * GPU-process pressure). three then throws "Error creating WebGL context." and
 * the page used to show a dead-end "can't open a WebGL context" screen.
 *
 * Now: probe without failIfMajorPerformanceCaveat and release the probe
 * immediately; create the context through a tier ladder; cap DPR on iOS and
 * clamp to MAX_RENDERBUFFER_SIZE; retry / remount with backoff on failure or
 * context loss; and only then show a Retry screen with a diagnostic line.
 */

export type GLTierName = "webgl2" | "webgl2-safe" | "webgl1";

export type GLTier = {
  name: GLTierName;
  context: "webgl2" | "webgl";
  attributes: WebGLContextAttributes;
  /** Upper bound on device pixel ratio for this tier. */
  maxDpr: number;
  bloom: boolean;
};

export const GL_TIERS: readonly GLTier[] = [
  { name: "webgl2", context: "webgl2", attributes: { alpha: false, antialias: true, powerPreference: "default", preserveDrawingBuffer: false }, maxDpr: 2, bloom: true },
  { name: "webgl2-safe", context: "webgl2", attributes: { alpha: false, antialias: false, powerPreference: "default", preserveDrawingBuffer: false, depth: true, stencil: false }, maxDpr: 1.5, bloom: false },
  // three r163+ renders WebGL2 only; this tier exists so detection/diagnostics can say "WebGL1 only" instead of failing blind.
  { name: "webgl1", context: "webgl", attributes: { alpha: false, antialias: false, powerPreference: "default" }, maxDpr: 1, bloom: false },
];

/** Tiers three.js can actually render with. */
export const RENDERABLE_TIERS = GL_TIERS.filter((t) => t.context === "webgl2");

/** Tier for the n-th attempt (0-based); sticks at the last renderable tier. */
export function tierForAttempt(attempt: number): GLTier {
  return RENDERABLE_TIERS[Math.min(Math.max(0, attempt), RENDERABLE_TIERS.length - 1)];
}

type NavLike = { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined;

/** iPhone/iPad, including iPadOS Safari that reports itself as a Mac. */
export function isIOSLike(nav: NavLike): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

export const IOS_MAX_DPR = 1.5;

/**
 * DPR for a canvas of cssW×cssH: min(device DPR, tier cap, iOS cap, quality cap)
 * and small enough that the drawing buffer stays within maxRenderbuffer.
 */
export function clampDpr(opts: { deviceDpr: number; tier: GLTier; ios: boolean; qualityMax?: number; cssW: number; cssH: number; maxRenderbuffer?: number | null }): number {
  let dpr = Math.max(0.5, opts.deviceDpr || 1);
  dpr = Math.min(dpr, opts.tier.maxDpr, opts.qualityMax ?? Infinity);
  if (opts.ios) dpr = Math.min(dpr, IOS_MAX_DPR);
  const longest = Math.max(1, opts.cssW, opts.cssH);
  const maxRb = opts.maxRenderbuffer && opts.maxRenderbuffer > 0 ? opts.maxRenderbuffer : 4096;
  if (longest * dpr > maxRb) dpr = maxRb / longest;
  return Math.max(0.5, Math.floor(dpr * 100) / 100);
}

/* ── Detection ────────────────────────────────────────────────────────── */

export { probeWebGL } from "@/lib/webglSupport";
export type ProbeResult = { webgl2: boolean; webgl1: boolean; error: string | null };

/** "Can't render" only when both WebGL2 and WebGL1 genuinely fail. */
export const webglUnavailable = (p: ProbeResult) => !p.webgl2 && !p.webgl1;

/* ── Retry policy ─────────────────────────────────────────────────────── */

export const MAX_GL_ATTEMPTS = 4;

/** Delay before attempt `next` (1-based count of failures so far), or null to stop and show Retry. */
export function retryDelay(failures: number, max = MAX_GL_ATTEMPTS): number | null {
  if (failures >= max) return null;
  return Math.min(4000, 250 * 2 ** Math.max(0, failures - 1));
}

/** Short diagnostic for the fallback screen. */
export function diagnosticLine(d: { tier: GLTierName; error: string | null; probe?: ProbeResult | null; attempts: number }): string {
  const p = d.probe ? ` · probe webgl2=${d.probe.webgl2 ? "ok" : "no"} webgl1=${d.probe.webgl1 ? "ok" : "no"}` : "";
  return `tier ${d.tier} failed after ${d.attempts} attempt${d.attempts === 1 ? "" : "s"}${d.error ? `: ${d.error.slice(0, 140)}` : ""}${p}`;
}
