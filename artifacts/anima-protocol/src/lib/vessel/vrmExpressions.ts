/**
 * Chat mood → VRM expression presets, limited to what the uploaded model
 * actually declares (`config.model.expressions`). Pure functions, no three.js.
 *
 * VRM 1.0 preset names are used internally (happy, angry, sad, relaxed,
 * surprised, neutral, blink, aa/ih/ou/ee/oh). VRM 0.x blend-shape names
 * (Joy, Sorrow, Fun, A, I, U, E, O, Blink…) are aliased onto them, which is
 * exactly how @pixiv/three-vrm exposes a VRM 0.x model at runtime.
 */
import type { Expression } from "./emotion";

export const VRM_MOOD_PRESETS = ["happy", "angry", "sad", "relaxed", "surprised", "neutral"] as const;
export type VrmMoodPreset = (typeof VRM_MOOD_PRESETS)[number];
export const VRM_VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
export type VrmViseme = (typeof VRM_VISEMES)[number];
export type VrmPreset = VrmMoodPreset | VrmViseme | "blink";
export type VrmWeights = Partial<Record<VrmPreset, number>>;

/** VRM 0.x blendShapeGroup names (lower-cased) → VRM 1.0 preset names. */
const VRM0_ALIASES: Record<string, VrmPreset> = {
  joy: "happy",
  sorrow: "sad",
  fun: "relaxed",
  angry: "angry",
  surprised: "surprised",
  neutral: "neutral",
  blink: "blink",
  a: "aa",
  i: "ih",
  u: "ou",
  e: "ee",
  o: "oh",
};
const PRESETS = new Set<string>([...VRM_MOOD_PRESETS, ...VRM_VISEMES, "blink"]);

/**
 * Normalise a model's declared expression names to the VRM 1.0 presets we drive.
 * `undefined` (no metadata, e.g. an external URL) means "trust the runtime model".
 */
export function availableVrmPresets(names: readonly string[] | undefined | null): Set<VrmPreset> | null {
  if (!names) return null;
  const out = new Set<VrmPreset>();
  for (const raw of names) {
    const k = String(raw || "").trim().toLowerCase();
    if (PRESETS.has(k)) out.add(k as VrmPreset);
    else if (VRM0_ALIASES[k]) out.add(VRM0_ALIASES[k]);
  }
  return out;
}

/** Chat mood keys (lib/moodDetector MOODS) → VRM preset weights at full intensity. */
export const MOOD_TO_VRM: Record<string, VrmWeights> = {
  happy: { happy: 0.85 },
  playful: { happy: 0.65, surprised: 0.2 },
  romantic: { relaxed: 0.6, happy: 0.25 },
  tender: { relaxed: 0.7, happy: 0.15 },
  curious: { surprised: 0.4, happy: 0.1 },
  watchful: { neutral: 0.5, angry: 0.1 },
  anxious: { sad: 0.35, surprised: 0.35 },
  fearful: { surprised: 0.65, sad: 0.3 },
  sad: { sad: 0.8 },
  hostile: { angry: 0.85 },
  cold: { neutral: 0.6, angry: 0.15 },
  neutral: { neutral: 0.3 },
  // companionAffect / livingPresence also emit these
  calm: { relaxed: 0.4 },
  joy: { happy: 0.85 },
  angry: { angry: 0.85 },
  surprised: { surprised: 0.8 },
  relaxed: { relaxed: 0.7 },
};

function pct(intensity: unknown): number {
  const raw = Number(intensity);
  if (!Number.isFinite(raw)) return 0.5;
  // Intensity arrives as 0-10 (chat affect) or 0-100, same as expressionFor().
  return Math.max(0, Math.min(1, raw <= 10 ? raw / 10 : raw / 100));
}

/** Keep only presets the model has; clamp to 0..1. */
export function limitWeights(w: VrmWeights, available: Set<VrmPreset> | null): VrmWeights {
  const out: VrmWeights = {};
  for (const [k, v] of Object.entries(w) as [VrmPreset, number][]) {
    if (available && !available.has(k)) continue;
    if (!Number.isFinite(v)) continue;
    out[k] = Math.max(0, Math.min(1, v));
  }
  return out;
}

/** Mood + intensity → eased-target weights for the model's mood presets. */
export function moodToVrmWeights(mood: string | null | undefined, intensity: unknown, available: Set<VrmPreset> | null): VrmWeights {
  const base = MOOD_TO_VRM[String(mood || "neutral").toLowerCase()] || MOOD_TO_VRM.neutral;
  const k = Math.max(0.3, Math.min(1, pct(intensity) + 0.3));
  const scaled: VrmWeights = {};
  for (const [p, v] of Object.entries(base) as [VrmPreset, number][]) scaled[p] = v * k;
  return limitWeights(scaled, available);
}

/**
 * Procedural face weights (lib/vessel/emotion Expression, or VesselShift.face)
 * → VRM mood presets. Used where the renderer only receives an Expression.
 */
export function expressionToVrmWeights(e: Expression, available: Set<VrmPreset> | null): VrmWeights {
  const smile = Math.max(-1, Math.min(1, e.smile || 0));
  const brow = Math.max(-1, Math.min(1, e.brow || 0));
  const energy = Math.max(0, Math.min(1, e.energy || 0));
  const w: VrmWeights = {
    happy: smile > 0.15 ? (smile - 0.15) / 0.85 * (0.5 + energy * 0.5) : 0,
    relaxed: smile > 0.15 ? (smile - 0.15) / 0.85 * (1 - energy) * 0.7 : 0,
    sad: smile < -0.1 && brow >= -0.2 ? Math.min(1, -smile * 1.2) * (1 - energy * 0.5) : 0,
    angry: brow < -0.3 ? Math.min(1, (-brow - 0.3) / 0.6) * (smile < 0.2 ? 1 : 0.3) : 0,
    surprised: brow > 0.5 && (e.eyeOpen ?? 0.85) > 0.9 ? Math.min(1, (brow - 0.5) * 2) * energy : 0,
  };
  for (const k of Object.keys(w) as VrmPreset[]) if (!w[k]) delete w[k];
  return limitWeights(w, available);
}

/** Frame-rate independent ease of every driven preset toward its target (absent → 0). */
export function easeWeights(current: VrmWeights, target: VrmWeights, dt: number, halfLife = 0.18): VrmWeights {
  const k = 1 - Math.pow(0.5, Math.max(0, dt) / Math.max(0.01, halfLife));
  const out: VrmWeights = {};
  const keys = new Set<VrmPreset>([...(Object.keys(current) as VrmPreset[]), ...(Object.keys(target) as VrmPreset[])]);
  for (const key of keys) {
    const c = current[key] ?? 0;
    const t = target[key] ?? 0;
    const v = c + (t - c) * k;
    if (v > 0.001 || t > 0) out[key] = v;
  }
  return out;
}

/**
 * Auto-blink: a closed-eye pulse (~150 ms) every 2–6 s. Deterministic when
 * given a seeded `rand`. Blinks are damped while `happy` is strong because
 * most VRM "happy" presets already close the eyes.
 */
export function createBlinker(rand: () => number = Math.random) {
  let until = 2 + rand() * 4;
  let t = 0;
  const DURATION = 0.15;
  return {
    update(dt: number, happy = 0): number {
      t += Math.max(0, dt);
      if (t >= until + DURATION) {
        t = 0;
        until = 2 + rand() * 4;
      }
      if (t < until) return 0;
      const p = (t - until) / DURATION; // 0..1
      const shape = Math.sin(Math.min(1, p) * Math.PI);
      return shape * (1 - Math.min(1, happy) * 0.8);
    },
  };
}
