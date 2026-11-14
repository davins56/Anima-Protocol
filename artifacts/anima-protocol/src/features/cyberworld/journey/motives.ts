/**
 * Companion motives: four needs that drift up over time and are satisfied by
 * activities. Personality (from the companion's existing free-text fields)
 * scales how fast each need grows. Pure and deterministic.
 */
import { hashString, mulberry32 } from "../explore/rng";
import type { Need } from "../layout";

export type { Need };
export const NEEDS: readonly Need[] = ["rest", "curiosity", "social", "creativity"];

/** Urgency per need, 0 (satisfied) .. 1 (pressing). */
export type Motives = Record<Need, number>;
/** Growth multipliers per need (≈0.6–1.6); 1 = neutral. */
export type Personality = Record<Need, number>;

export const NEUTRAL: Personality = { rest: 1, curiosity: 1, social: 1, creativity: 1 };

/** Base growth per minute of sim time. */
export const DRIFT_PER_MIN: Motives = { rest: 0.05, curiosity: 0.08, social: 0.07, creativity: 0.06 };

/** Keyword → need nudges, applied to the companion's personality / speaking style / mood text. */
const TRAIT_WORDS: readonly [RegExp, Partial<Personality>][] = [
  [/curious|inquisitive|explor|adventur|nerd|scholar|bookish|analytic/i, { curiosity: 0.4 }],
  [/social|outgoing|friendly|warm|bubbly|extrovert|chatty|playful/i, { social: 0.4 }],
  [/shy|introvert|reserved|quiet|calm|gentle|serene|sleepy/i, { rest: 0.35, social: -0.25 }],
  [/creative|artist|artistic|poet|music|dream|imaginative|whimsical/i, { creativity: 0.4 }],
  [/energetic|restless|hyper|bold/i, { rest: -0.3, curiosity: 0.15 }],
];

/** Personality from whatever companion fields exist (personality, speaking_style, mood…); neutral fallback. */
export function personalityFromRecord(record?: Record<string, unknown> | null): Personality {
  const text = ["personality", "speaking_style", "mood", "description", "archetype"]
    .map((k) => record?.[k])
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  const p: Personality = { ...NEUTRAL };
  if (!text) return p;
  for (const [re, nudge] of TRAIT_WORDS) {
    if (!re.test(text)) continue;
    for (const n of NEEDS) p[n] += nudge[n] ?? 0;
  }
  for (const n of NEEDS) p[n] = Math.min(1.6, Math.max(0.6, p[n]));
  return p;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Deterministic starting motives for a companion's day. */
export function initialMotives(seed: number): Motives {
  const r = mulberry32(seed ^ hashString("motives"));
  return { rest: 0.15 + r() * 0.25, curiosity: 0.2 + r() * 0.35, social: 0.2 + r() * 0.35, creativity: 0.15 + r() * 0.3 };
}

export function driftMotives(m: Motives, minutes: number, p: Personality = NEUTRAL): Motives {
  const out = { ...m };
  for (const n of NEEDS) out[n] = clamp01(m[n] + DRIFT_PER_MIN[n] * p[n] * Math.max(0, minutes));
  return out;
}

/** An activity that serves `needs` (0..1 each) lowers those motives proportionally. */
export function satisfy(m: Motives, needs: Partial<Record<Need, number>>, strength = 0.7): Motives {
  const out = { ...m };
  for (const n of NEEDS) out[n] = clamp01(m[n] * (1 - (needs[n] ?? 0) * strength));
  return out;
}

export function dominantNeed(m: Motives): Need {
  return NEEDS.reduce((a, b) => (m[b] > m[a] ? b : a), NEEDS[0]);
}
