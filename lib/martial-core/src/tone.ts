/**
 * Battle tone from the PUBLIC affect layer only (§5, K3; Serenity's note).
 *
 * The input is typed to the #765 allowlisted public snapshot. Anything else on
 * the object (focus, intent, openLoops, cause, memory text, raw selfState) is
 * never read. A snapshot that is not marked `layer: "public"` gives `composed`.
 * With emotions off, or with no snapshot, the tone is the neutral `composed`.
 */
import type { Tone } from "./types";

export type PublicAffectSnapshot = {
  layer?: "public" | "composed" | string;
  primary?: string;
  intensity?: number;
  energy?: number;
  dims?: { valence?: number; arousal?: number; dominance?: number; stability?: number };
  undertone?: { kind?: string; intensity?: number } | null;
  expressed?: string | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function toneFromSnapshot(snapshot: PublicAffectSnapshot | null | undefined, opts: { emotionsEnabled: boolean }): Tone {
  if (!opts.emotionsEnabled || !snapshot || typeof snapshot !== "object") return "composed";
  if (snapshot.layer !== "public") return "composed";
  const primary = typeof snapshot.primary === "string" ? snapshot.primary.toLowerCase() : "";
  const expressed = typeof snapshot.expressed === "string" ? snapshot.expressed.toLowerCase() : "";
  const label = expressed || primary;
  const intensity = num(snapshot.intensity) ?? 0;
  const d = snapshot.dims && typeof snapshot.dims === "object" ? snapshot.dims : {};
  const valence = num(d.valence);
  const arousal = num(d.arousal);
  const dominance = num(d.dominance);
  const stability = num(d.stability);
  if ((stability !== null && stability < 0.3) || ((label === "fearful" || label === "anxious") && intensity >= 60)) return "shaken";
  if ((arousal !== null && arousal >= 0.55 && valence !== null && valence < 0) || label === "hostile") return "fierce";
  if ((dominance !== null && dominance < -0.2) || label === "watchful" || label === "cold") return "guarded";
  if ((valence !== null && valence >= 0.3 && arousal !== null && arousal >= 0.4) || label === "playful" || label === "happy") return "playful";
  return "composed";
}
