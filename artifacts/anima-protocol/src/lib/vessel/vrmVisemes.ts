/**
 * Companion speech → VRM visemes (aa/ih/ou/ee/oh), limited to the model's
 * declared `config.model.visemes`. Mouth openness comes from
 * livingPresence.getVisemeOpenness, or from a live voice audio level (0..1)
 * when the caller has one.
 */
import { getVisemeOpenness } from "@/lib/livingPresence";
import { VRM_VISEMES, type VrmViseme, type VrmWeights } from "./vrmExpressions";

const REST = 0.08; // getVisemeOpenness() value while silent

/** 0..1 mouth openness; an explicit audio level wins over the synthetic pulse. */
export function speechOpenness(tMs: number, speaking: boolean, audioLevel?: number | null): number {
  if (!speaking) return 0;
  const lvl = Number(audioLevel);
  if (audioLevel != null && Number.isFinite(lvl)) return Math.max(0, Math.min(1, lvl * 1.6));
  const o = getVisemeOpenness(tMs, true);
  return Math.max(0, Math.min(1, (o - REST) / (1 - REST)));
}

/** Viseme cycle while talking; "aa" leads because it reads as an open mouth on every rig. */
const CYCLE: VrmViseme[] = ["aa", "oh", "ee", "aa", "ih", "ou"];
const STEP_MS = 110;

export function availableVisemes(visemes: readonly string[] | undefined | null): VrmViseme[] | null {
  if (!visemes) return null;
  const set = new Set(visemes.map((v) => String(v).toLowerCase()));
  return VRM_VISEMES.filter((v) => set.has(v));
}

/**
 * Openness → per-viseme weights. Crossfades between consecutive vowels in
 * CYCLE so the mouth changes shape, not just size. Visemes the model does not
 * have are skipped; with none available nothing is driven.
 */
export function visemeWeights(tMs: number, openness: number, available: VrmViseme[] | null): VrmWeights {
  const allowed = (available ?? [...VRM_VISEMES]).filter(Boolean);
  const out: VrmWeights = {};
  const o = Math.max(0, Math.min(1, openness));
  if (!allowed.length || o <= 0.001) return out;
  const cycle = CYCLE.filter((v) => allowed.includes(v));
  const seq = cycle.length ? cycle : allowed;
  const pos = Math.max(0, tMs) / STEP_MS;
  const i = Math.floor(pos) % seq.length;
  const j = (i + 1) % seq.length;
  const f = pos - Math.floor(pos);
  const a = seq[i];
  const b = seq[j];
  out[a] = (out[a] ?? 0) + o * (1 - f);
  out[b] = (out[b] ?? 0) + o * f;
  for (const k of Object.keys(out) as VrmViseme[]) out[k] = Math.min(1, out[k]!);
  return out;
}
