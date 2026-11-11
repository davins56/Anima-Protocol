/**
 * The W axis (resonance frequency, 0–100). Same spectrum as
 * design/anima-tokens.json → artifacts/anima-protocol/src/styles/anima-tokens.ts
 * (a frontend test asserts the two stay identical).
 */
export const W_MIN = 0;
export const W_MAX = 100;

export type BandKey = "noise" | "ambient" | "data" | "rare" | "serenity";

export type BandSpec = {
  key: BandKey;
  index: number;
  min: number;
  max: number;
  color: string;
  /** Serenity's signal clarity at this band's centre (0 = pure static, 1 = clear). */
  clarity: number;
};

export const BANDS: readonly BandSpec[] = [
  { key: "noise", index: 0, min: 0, max: 20, color: "#B91C1C", clarity: 0.15 },
  { key: "ambient", index: 1, min: 20, max: 45, color: "#F59E0B", clarity: 0.45 },
  { key: "data", index: 2, min: 45, max: 75, color: "#14B8A6", clarity: 0.65 },
  { key: "rare", index: 3, min: 75, max: 88, color: "#FACC15", clarity: 0.85 },
  { key: "serenity", index: 4, min: 88, max: 100, color: "#8B5CF6", clarity: 1 },
] as const;

export const BAND_BY_KEY: Record<BandKey, BandSpec> = Object.fromEntries(BANDS.map((b) => [b.key, b])) as Record<
  BandKey,
  BandSpec
>;

/** One arena layer per band, centred on the band. */
export const LAYER_COUNT = BANDS.length;
export const LAYER_W: readonly number[] = BANDS.map((b) => (b.min + b.max) / 2);

export function clampW(w: number): number {
  return Math.min(W_MAX, Math.max(W_MIN, Number.isFinite(w) ? w : 0));
}

/** Band containing W (upper bound exclusive except at 100). */
export function bandAt(w: number): BandSpec {
  const f = clampW(w);
  return BANDS.find((b) => f >= b.min && f < b.max) ?? BANDS[BANDS.length - 1];
}

export function layerAt(w: number): number {
  return bandAt(w).index;
}

/**
 * Serenity's signal clarity as a continuous function of W: piecewise-linear
 * between band centres (no detents), flat outside the outer centres.
 * Drives chip power, voice/comms clarity and visual noise.
 */
export function clarityAt(w: number): number {
  const f = clampW(w);
  if (f <= LAYER_W[0]) return BANDS[0].clarity;
  for (let i = 1; i < LAYER_W.length; i++) {
    if (f <= LAYER_W[i]) {
      const t = (f - LAYER_W[i - 1]) / (LAYER_W[i] - LAYER_W[i - 1]);
      return BANDS[i - 1].clarity + (BANDS[i].clarity - BANDS[i - 1].clarity) * t;
    }
  }
  return BANDS[BANDS.length - 1].clarity;
}

/** 0 for the same band … 1 for opposite ends of the spectrum. */
export function bandDistance(a: BandKey, b: BandKey): number {
  return Math.abs(BAND_BY_KEY[a].index - BAND_BY_KEY[b].index);
}
