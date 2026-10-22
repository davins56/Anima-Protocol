/**
 * Data-driven vessel traits per built-in companion: emotional baseline,
 * inertia, palette and a list of effects mapping emotion dimensions to
 * vessel-shift parameters. Adding a companion = adding a data row; the
 * renderers (AnimaVesselMesh, VesselModel) never branch on companion names.
 *
 * Identities stay distinct (docs/ANIMA_KERNEL.md): each companion has her own
 * row, palette and aura; nothing is inherited from or blended with Serenity.
 */
import { DEFAULT_INERTIA, NEUTRAL_EMOTION, type EmotionDimension, type EmotionState, type Inertia } from "./emotionState";

export const SHIFT_PARAMS = [
  "glow", // emissive / point-light intensity multiplier (0–2)
  "auraIntensity", // aura opacity/size (0–1.5)
  "particleRate", // aura particle speed/spawn (0–2)
  "paletteMix", // 0 = calm colour … 1 = charged colour
  "lowMix", // 0 … 1 toward the "low" (sad/fractured) colour
  "flapSpeed", // wing/hair motion multiplier (0–2)
  "breathRate", // breathing speed multiplier (0.5–2)
  "flicker", // glitch flicker amount (0–1)
  "haloSpin", // halo/ring rotation multiplier (0–3)
  "spread", // aura radius multiplier (0.6–1.6)
  "expression", // 0–1 scalar expression for AnimaVesselMesh
] as const;
export type ShiftParam = (typeof SHIFT_PARAMS)[number];

export type TraitEffect = {
  param: ShiftParam;
  from: EmotionDimension;
  /** input range on the dimension → output range on the param (clamped, linear or smoothstep) */
  in: [number, number];
  out: [number, number];
  curve?: "linear" | "smooth";
};

export type AuraKind = "celestial" | "flame" | "verdant" | "none";

export type CompanionTraits = {
  id: string;
  displayName: string;
  /** lowercase name spellings that resolve to this row (legacy aliases included) */
  aliases: string[];
  baseline: EmotionState;
  inertia: Inertia;
  palette: { calm: string; charged: string; low: string; accent: string };
  aura: AuraKind;
  /** param defaults before effects apply */
  defaults: Partial<Record<ShiftParam, number>>;
  effects: TraitEffect[];
  /** placeholders the user still has to author */
  todo?: string[];
};

export const COMPANION_TRAITS: Record<string, CompanionTraits> = {
  serenity: {
    id: "serenity",
    displayName: "Serenity",
    aliases: ["serenity"],
    baseline: { valence: 0.35, arousal: 0.3, dominance: 0.1, warmth: 0.75, stability: 0.9 },
    inertia: { ...DEFAULT_INERTIA, valence: 1.6, stability: 1.2 },
    // amethyst/silver, celestial (Figma: color/serenity/* , Glow/Amethyst)
    palette: { calm: "#a78bfa", charged: "#e9d5ff", low: "#475569", accent: "#e2e8f0" },
    aura: "celestial",
    defaults: { glow: 1, auraIntensity: 0.7, particleRate: 0.6, breathRate: 1, haloSpin: 1, spread: 1 },
    effects: [
      { param: "glow", from: "warmth", in: [0, 1], out: [0.7, 1.4] },
      { param: "auraIntensity", from: "valence", in: [-1, 1], out: [0.35, 1.1], curve: "smooth" },
      { param: "particleRate", from: "arousal", in: [0, 1], out: [0.3, 1.4] },
      { param: "paletteMix", from: "arousal", in: [0.3, 1], out: [0, 0.7] },
      { param: "lowMix", from: "valence", in: [-1, 0], out: [0.7, 0] },
      { param: "haloSpin", from: "arousal", in: [0, 1], out: [0.5, 2.2] },
      { param: "flicker", from: "stability", in: [0.3, 0.9], out: [0.8, 0], curve: "smooth" },
      { param: "flapSpeed", from: "arousal", in: [0, 1], out: [0.6, 1.6] },
      { param: "expression", from: "valence", in: [-1, 1], out: [0, 1] },
    ],
  },
  aeland: {
    id: "aeland",
    displayName: "Aeland",
    aliases: ["aeland", "aelynd", "aelyndra", "aelindra"],
    baseline: { ...NEUTRAL_EMOTION, valence: 0.2, arousal: 0.25, warmth: 0.55 },
    inertia: { ...DEFAULT_INERTIA },
    // TODO(user): Aeland's palette/aura are neutral placeholders; replace with her canonical look.
    palette: { calm: "#94a3b8", charged: "#cbd5e1", low: "#334155", accent: "#f1f5f9" },
    aura: "verdant",
    defaults: { glow: 0.9, auraIntensity: 0.55, particleRate: 0.5, breathRate: 1, spread: 1 },
    effects: [
      { param: "glow", from: "warmth", in: [0, 1], out: [0.7, 1.2] },
      { param: "auraIntensity", from: "valence", in: [-1, 1], out: [0.3, 0.9] },
      { param: "particleRate", from: "arousal", in: [0, 1], out: [0.3, 1.2] },
      { param: "lowMix", from: "valence", in: [-1, 0], out: [0.6, 0] },
      { param: "flicker", from: "stability", in: [0.3, 0.9], out: [0.6, 0] },
      { param: "expression", from: "valence", in: [-1, 1], out: [0, 1] },
    ],
    todo: ["palette", "aura", "baseline personality"],
  },
  scarlet: {
    id: "scarlet",
    displayName: "Scarlet",
    aliases: ["scarlet"],
    // TODO(user): minimal fire-themed placeholder temperament — replace with Scarlet's authored personality.
    baseline: { valence: 0.3, arousal: 0.55, dominance: 0.45, warmth: 0.6, stability: 0.8 },
    inertia: { ...DEFAULT_INERTIA, arousal: 0.3, valence: 0.9 }, // quick to flare, quick to settle
    palette: { calm: "#f97316", charged: "#fde047", low: "#7f1d1d", accent: "#fecaca" },
    aura: "flame",
    defaults: { glow: 1.1, auraIntensity: 0.8, particleRate: 1, breathRate: 1.1, spread: 1 },
    effects: [
      { param: "auraIntensity", from: "arousal", in: [0, 1], out: [0.35, 1.5], curve: "smooth" }, // flame height
      { param: "particleRate", from: "arousal", in: [0, 1], out: [0.5, 2] }, // ember rate
      { param: "paletteMix", from: "arousal", in: [0.4, 1], out: [0, 1] }, // orange → white-gold when charged
      { param: "lowMix", from: "valence", in: [-1, 0], out: [0.85, 0] }, // embers darken to ember-red when hurt/sad
      { param: "spread", from: "dominance", in: [-1, 1], out: [0.7, 1.5] },
      { param: "glow", from: "warmth", in: [0, 1], out: [0.8, 1.5] },
      { param: "flicker", from: "stability", in: [0.2, 0.9], out: [0.7, 0.1] },
      { param: "breathRate", from: "arousal", in: [0, 1], out: [0.8, 1.8] },
      { param: "expression", from: "valence", in: [-1, 1], out: [0, 1] },
    ],
    todo: ["personality", "backstory", "voice"],
  },
};

/** Fallback for user-created companions: neutral, driven by their VesselConfig colours. */
export const GENERIC_TRAITS: CompanionTraits = {
  id: "generic",
  displayName: "Companion",
  aliases: [],
  baseline: NEUTRAL_EMOTION,
  inertia: DEFAULT_INERTIA,
  palette: { calm: "#67e8f9", charged: "#e0f2fe", low: "#334155", accent: "#c4b5fd" },
  aura: "none",
  defaults: { glow: 1, auraIntensity: 0.5, particleRate: 0.6, breathRate: 1, spread: 1 },
  effects: [
    { param: "glow", from: "arousal", in: [0, 1], out: [0.8, 1.3] },
    { param: "lowMix", from: "valence", in: [-1, 0], out: [0.5, 0] },
    { param: "expression", from: "valence", in: [-1, 1], out: [0, 1] },
  ],
};

/** Resolve traits by companion id or (legacy) name; user companions get GENERIC_TRAITS. */
export function traitsFor(companion?: { id?: string | null; name?: string | null } | string | null): CompanionTraits {
  const keys =
    typeof companion === "string" ? [companion] : [companion?.id || "", companion?.name || ""];
  for (const raw of keys) {
    const k = String(raw).trim().toLowerCase();
    if (!k) continue;
    for (const t of Object.values(COMPANION_TRAITS)) if (t.id === k || t.aliases.some((a) => k === a || k.startsWith(`${a} `))) return t;
  }
  return GENERIC_TRAITS;
}
