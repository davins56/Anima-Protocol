/** Map chat mood (lib/moodDetector MOODS keys) → procedural facial expression weights. */
export type Expression = { smile: number; brow: number; eyeOpen: number; tilt: number; energy: number };

const TABLE: Record<string, Expression> = {
  happy:    { smile: 0.9, brow: 0.3, eyeOpen: 0.9, tilt: 0.05, energy: 0.8 },
  playful:  { smile: 0.8, brow: 0.5, eyeOpen: 1.0, tilt: 0.15, energy: 1.0 },
  romantic: { smile: 0.6, brow: 0.1, eyeOpen: 0.7, tilt: 0.12, energy: 0.5 },
  tender:   { smile: 0.5, brow: 0.0, eyeOpen: 0.75, tilt: 0.1, energy: 0.4 },
  curious:  { smile: 0.2, brow: 0.7, eyeOpen: 1.0, tilt: 0.18, energy: 0.6 },
  watchful: { smile: 0.0, brow: -0.2, eyeOpen: 0.85, tilt: 0.0, energy: 0.3 },
  anxious:  { smile: -0.2, brow: 0.6, eyeOpen: 1.0, tilt: -0.05, energy: 0.7 },
  fearful:  { smile: -0.4, brow: 0.9, eyeOpen: 1.0, tilt: -0.1, energy: 0.9 },
  sad:      { smile: -0.6, brow: 0.4, eyeOpen: 0.55, tilt: -0.12, energy: 0.2 },
  hostile:  { smile: -0.5, brow: -0.8, eyeOpen: 0.7, tilt: 0.0, energy: 0.9 },
  cold:     { smile: -0.2, brow: -0.4, eyeOpen: 0.6, tilt: 0.0, energy: 0.1 },
  neutral:  { smile: 0.1, brow: 0.0, eyeOpen: 0.85, tilt: 0.0, energy: 0.35 },
};

export function expressionFor(mood?: string | null, intensity = 50): Expression {
  const base = TABLE[mood || "neutral"] || TABLE.neutral;
  // Intensity arrives as 0-10 (chat affect) or 0-100.
  const raw = Number(intensity);
  const pct = !Number.isFinite(raw) ? 50 : raw <= 10 ? raw * 10 : Math.min(100, raw);
  const k = Math.max(0.3, Math.min(1, pct / 100 + 0.3));
  const n = TABLE.neutral;
  const mix = (a: number, b: number) => b + (a - b) * k;
  return {
    smile: mix(base.smile, n.smile),
    brow: mix(base.brow, n.brow),
    eyeOpen: mix(base.eyeOpen, n.eyeOpen),
    tilt: mix(base.tilt, n.tilt),
    energy: mix(base.energy, n.energy),
  };
}
