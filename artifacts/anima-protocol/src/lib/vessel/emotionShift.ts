/**
 * Emotion × traits → VesselShift: a renderer-agnostic bundle of numbers and
 * colours. AnimaVesselMesh (battle navi, Sovereign Presence) and VesselModel
 * (Vessel Studio, chat portrait) both consume the same shift through
 * <VesselAura> and their existing colour/expression props.
 */
import type { Expression } from "./emotion";
import { EMOTION_DIMENSIONS, type EmotionState } from "./emotionState";
import { SHIFT_PARAMS, type AuraKind, type CompanionTraits, type ShiftParam } from "./vesselTraits";

export type VesselShift = Record<ShiftParam, number> & {
  aura: AuraKind;
  color: string;
  accent: string;
  /** detailed weights for VesselModel's face rig */
  face: Expression;
};

const BASE: Record<ShiftParam, number> = {
  glow: 1, auraIntensity: 0.5, particleRate: 0.6, paletteMix: 0, lowMix: 0, flapSpeed: 1, breathRate: 1, flicker: 0, haloSpin: 1, spread: 1, expression: 0.5,
};

const smooth = (t: number) => t * t * (3 - 2 * t);

function hex(h: string): [number, number, number] {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function mixHex(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b), k = Math.min(1, Math.max(0, t));
  return "#" + x.map((c, i) => Math.round(c + (y[i] - c) * k).toString(16).padStart(2, "0")).join("");
}

export function computeVesselShift(e: EmotionState, traits: CompanionTraits, opts: { reducedMotion?: boolean } = {}): VesselShift {
  const p: Record<ShiftParam, number> = { ...BASE, ...traits.defaults } as Record<ShiftParam, number>;
  for (const fx of traits.effects) {
    const [i0, i1] = fx.in;
    const [o0, o1] = fx.out;
    let t = i1 === i0 ? 0 : (e[fx.from] - i0) / (i1 - i0);
    t = Math.min(1, Math.max(0, t));
    if (fx.curve === "smooth") t = smooth(t);
    p[fx.param] = o0 + (o1 - o0) * t;
  }
  if (opts.reducedMotion) {
    p.particleRate *= 0.3;
    p.flapSpeed = Math.min(p.flapSpeed, 0.6);
    p.flicker = 0;
    p.haloSpin *= 0.4;
  }
  for (const k of SHIFT_PARAMS) if (!Number.isFinite(p[k])) p[k] = BASE[k];
  const color = mixHex(mixHex(traits.palette.calm, traits.palette.charged, p.paletteMix), traits.palette.low, p.lowMix);
  const face: Expression = {
    smile: Math.max(-1, Math.min(1, e.valence * 0.9)),
    brow: Math.max(-1, Math.min(1, -e.dominance * 0.5 + (e.arousal - 0.5) * 0.6 * (e.valence < 0 ? 1 : 0.3))),
    eyeOpen: Math.min(1, 0.6 + e.arousal * 0.4),
    tilt: (e.warmth - 0.5) * 0.25,
    energy: e.arousal,
  };
  return { ...p, aura: traits.aura, color, accent: traits.palette.accent, face };
}

/** Quantise so React only re-renders when the shift visibly changes. */
export function shiftKey(s: VesselShift): string {
  return [s.color, ...SHIFT_PARAMS.map((k) => Math.round(s[k] * 20))].join("|");
}

/** Apply a shift to an AnimaVesselMesh model ({color, accent, gold}). */
export function shiftBattleModel<T extends { color?: string; accent?: string }>(model: T, s: VesselShift | null): T {
  if (!s) return model;
  return { ...model, color: s.color, accent: mixHex(model.accent || s.accent, s.accent, 0.5) };
}

export { EMOTION_DIMENSIONS };
