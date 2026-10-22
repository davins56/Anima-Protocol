/**
 * Emotional state that drives vessel-shift. Five continuous dimensions:
 *
 *   valence    −1 … 1   unpleasant ↔ pleasant
 *   arousal     0 … 1   calm ↔ activated (energy, flame height, particle rate)
 *   dominance  −1 … 1   yielding ↔ assertive (posture, aura spread)
 *   warmth      0 … 1   distance ↔ closeness to the user (bond; palette warmth)
 *   stability   0 … 1   fractured ↔ coherent (signal clarity; flicker/glitch)
 *
 * Stimuli (chat mood, voice energy, net-battle events) set a *target*; the
 * state eases toward it with per-companion inertia and relaxes to the
 * companion's baseline when stimuli stop. Pure functions, no React.
 */
import type { CorruptionRecord, SimState } from "@workspace/sim-core";
import { clarityAt } from "@workspace/sim-core";

export const EMOTION_DIMENSIONS = ["valence", "arousal", "dominance", "warmth", "stability"] as const;
export type EmotionDimension = (typeof EMOTION_DIMENSIONS)[number];
export type EmotionState = Record<EmotionDimension, number>;

const RANGE: Record<EmotionDimension, [number, number]> = {
  valence: [-1, 1],
  arousal: [0, 1],
  dominance: [-1, 1],
  warmth: [0, 1],
  stability: [0, 1],
};

export const NEUTRAL_EMOTION: EmotionState = { valence: 0.1, arousal: 0.3, dominance: 0, warmth: 0.5, stability: 0.85 };

export function clampEmotion(e: Partial<EmotionState>, base: EmotionState = NEUTRAL_EMOTION): EmotionState {
  const out = { ...base };
  for (const d of EMOTION_DIMENSIONS) {
    const v = Number(e[d]);
    if (Number.isFinite(v)) out[d] = Math.min(RANGE[d][1], Math.max(RANGE[d][0], v));
  }
  return out;
}

/** Chat/voice mood keys (lib/moodDetector MOODS) → emotion target. */
const MOOD_TABLE: Record<string, Partial<EmotionState>> = {
  happy: { valence: 0.8, arousal: 0.6, dominance: 0.2, warmth: 0.7 },
  playful: { valence: 0.7, arousal: 0.8, dominance: 0.3, warmth: 0.7 },
  romantic: { valence: 0.7, arousal: 0.5, warmth: 0.95 },
  tender: { valence: 0.6, arousal: 0.25, warmth: 0.9 },
  curious: { valence: 0.3, arousal: 0.55, dominance: 0.1 },
  watchful: { valence: 0, arousal: 0.4, dominance: 0.2, warmth: 0.45 },
  anxious: { valence: -0.4, arousal: 0.75, dominance: -0.4, stability: 0.5 },
  fearful: { valence: -0.7, arousal: 0.9, dominance: -0.7, stability: 0.35 },
  sad: { valence: -0.7, arousal: 0.15, dominance: -0.3, warmth: 0.55 },
  hostile: { valence: -0.6, arousal: 0.9, dominance: 0.8, warmth: 0.15, stability: 0.55 },
  cold: { valence: -0.2, arousal: 0.1, dominance: 0.3, warmth: 0.1 },
  neutral: {},
};

/** `intensity` is 0–10 (chat affect) or 0–100; it scales the distance from neutral. */
export function moodToEmotion(mood?: string | null, intensity = 50): EmotionState {
  const raw = Number(intensity);
  const k = !Number.isFinite(raw) ? 0.5 : Math.min(1, Math.max(0.2, (raw <= 10 ? raw * 10 : raw) / 100));
  const t = MOOD_TABLE[mood || "neutral"] || {};
  const out = { ...NEUTRAL_EMOTION };
  for (const d of EMOTION_DIMENSIONS) if (t[d] !== undefined) out[d] = NEUTRAL_EMOTION[d] + (t[d]! - NEUTRAL_EMOTION[d]) * k;
  return clampEmotion(out);
}

/** Net battle → emotion target: HP and danger raise arousal, W clarity sets stability, corruption hurts. */
export function simToEmotion(s: SimState): EmotionState {
  const navi = s.units[0];
  const hp = navi.maxHp > 0 ? navi.hp / navi.maxHp : 1;
  const threatened = s.units.some((u) => u.side === "enemy" && u.hp > 0 && u.telegraph);
  const open = s.corruptions.filter((c: CorruptionRecord) => !c.restored).length;
  const base: Partial<EmotionState> = {
    valence: 0.2 + 0.5 * (hp - 0.5) - 0.25 * open,
    arousal: 0.55 + (threatened ? 0.25 : 0) + (1 - hp) * 0.2,
    dominance: 0.1 + 0.4 * (hp - 0.5),
    stability: clarityAt(navi.w) * (1 - 0.15 * open),
  };
  if (s.outcome === "win") Object.assign(base, { valence: 0.85, arousal: 0.65, dominance: 0.5 });
  if (s.outcome === "lose") Object.assign(base, { valence: -0.6, arousal: 0.2, dominance: -0.5 });
  return clampEmotion(base);
}

export type Inertia = Record<EmotionDimension, number>; // half-life in seconds
export const DEFAULT_INERTIA: Inertia = { valence: 1.2, arousal: 0.5, dominance: 1.5, warmth: 4, stability: 0.8 };

/**
 * Ease `current` toward `target` (or `baseline` when target is null) with a
 * per-dimension half-life. Frame-rate independent.
 */
export function stepEmotion(current: EmotionState, target: EmotionState | null, baseline: EmotionState, dt: number, inertia: Inertia = DEFAULT_INERTIA, relaxFactor = 4): EmotionState {
  const goal = target ?? baseline;
  const out = { ...current };
  for (const d of EMOTION_DIMENSIONS) {
    const hl = Math.max(0.05, inertia[d] * (target ? 1 : relaxFactor));
    const k = 1 - Math.pow(0.5, Math.max(0, dt) / hl);
    out[d] = current[d] + (goal[d] - current[d]) * k;
  }
  return clampEmotion(out);
}

export function emotionDistance(a: EmotionState, b: EmotionState): number {
  return Math.max(...EMOTION_DIMENSIONS.map((d) => Math.abs(a[d] - b[d])));
}
