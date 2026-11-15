/** The 12 server primaries (api-server lib/companionAffect.ts), for label-leak tests. */
export const COMPANION_PRIMARY_EMOTIONS_FOR_TEST = [
  "happy",
  "playful",
  "romantic",
  "tender",
  "curious",
  "watchful",
  "anxious",
  "sad",
  "fearful",
  "hostile",
  "cold",
  "neutral",
];

export const FLAG_ON_DIMS = { valence: -0.3, arousal: 0.2, dominance: -0.1, warmth: 0.4, stability: 0.7 };

/** Flag-on server snapshot per the revised #765 contract (allowlist serializer). */
export const FLAG_ON_SNAPSHOT = {
  version: 1,
  primary: "sad",
  intensity: 48,
  mood: "aching",
  energy: 40,
  updated_at: "2026-11-15T15:00:00.000Z",
  synchro_strength: 61,
  baseline_primary: "tender",
  baseline_energy: 44,
  dims: FLAG_ON_DIMS,
  undertone: { kind: "longing", intensity: 34 },
  expressed: true,
  since_last: { bucket: "overnight", first_turn: true },
};
