/**
 * Typed, versioned 3D vessel config (schema 1). Mirrors the server-side
 * whitelist in artifacts/api-server/src/lib/vessel/vesselStore.ts.
 */
import { z } from "zod";
import type { VisualDescriptor } from "@/lib/photo/photoApi";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const HAIR_STYLES = ["long", "bob", "pixie", "braid", "ponytail", "wild", "bun"] as const;
export const BODY_TYPES = ["slender", "athletic", "curvy", "petite", "tall"] as const;
export const AURAS = ["none", "halo", "wings", "sparks", "mist", "glitch"] as const;
export const ACCESSORIES = ["circlet", "earrings", "choker", "visor", "scarf", "halo-ring", "shoulder-plates"] as const;
export const TOPS = ["robe", "bodysuit", "jacket", "dress", "armor", "hoodie"] as const;
export const BOTTOMS = ["skirt", "trousers", "shorts", "gown"] as const;

export const VesselConfigSchema = z.object({
  schema: z.literal(1).default(1),
  base: z.enum(["serenity", "linda", "aelindra", "custom"]).default("custom"),
  bodyType: z.enum(BODY_TYPES).default("slender"),
  height: z.number().min(0.85).max(1.15).default(1),
  skinTone: hex.default("#c99a7a"),
  hair: z.object({ style: z.enum(HAIR_STYLES).default("long"), color: hex.default("#d8dde6") }).default({ style: "long", color: "#d8dde6" }),
  eyes: z.object({ color: hex.default("#22d3ee"), glow: z.number().min(0).max(1).default(0.4) }).default({ color: "#22d3ee", glow: 0.4 }),
  outfit: z
    .object({
      top: z.string().max(40).default("robe"),
      bottom: z.string().max(40).default("skirt"),
      color: hex.default("#f1f5f9"),
      accent: hex.default("#d4af37"),
    })
    .default({ top: "robe", bottom: "skirt", color: "#f1f5f9", accent: "#d4af37" }),
  accessories: z.array(z.string().max(30)).max(8).default([]),
  effects: z
    .object({
      aura: z.enum(AURAS).default("none"),
      glow: z.number().min(0).max(1).default(0.3),
      particles: z.number().int().min(0).max(400).default(60),
      color: hex.default("#00e5ff"),
    })
    .default({ aura: "none", glow: 0.3, particles: 60, color: "#00e5ff" }),
  /** Asset slot: procedural placeholder by default; glTF/VRM when a licensed model URL is set. */
  model: z
    .object({ kind: z.enum(["procedural", "gltf", "vrm"]).default("procedural"), url: z.string().max(500).optional() })
    .default({ kind: "procedural" }),
});

export type VesselConfig = z.infer<typeof VesselConfigSchema>;

export const VESSEL_PRESETS: Record<string, Partial<VesselConfig>> = {
  serenity: {
    base: "serenity",
    skinTone: "#e9c9b4",
    hair: { style: "long", color: "#e8ecf2" },
    eyes: { color: "#38e1ff", glow: 0.6 },
    outfit: { top: "robe", bottom: "gown", color: "#f8fafc", accent: "#d4af37" },
    accessories: ["circlet"],
    effects: { aura: "halo", glow: 0.55, particles: 90, color: "#7dd3fc" },
  },
  linda: {
    base: "linda",
    skinTone: "#d9a888",
    hair: { style: "wild", color: "#6b3a22" },
    eyes: { color: "#4ade80", glow: 0.2 },
    outfit: { top: "jacket", bottom: "trousers", color: "#1f2937", accent: "#f97316" },
    effects: { aura: "sparks", glow: 0.3, particles: 50, color: "#fb923c" },
  },
  aelindra: {
    base: "aelindra",
    skinTone: "#b98a6a",
    hair: { style: "braid", color: "#1c1917" },
    eyes: { color: "#a78bfa", glow: 0.5 },
    outfit: { top: "dress", bottom: "gown", color: "#312e81", accent: "#c4b5fd" },
    accessories: ["earrings"],
    effects: { aura: "mist", glow: 0.45, particles: 70, color: "#a78bfa" },
  },
};

export function parseVesselConfig(raw: unknown): VesselConfig {
  const r = VesselConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : VesselConfigSchema.parse({});
}

/** Default vessel for a character when nothing is saved yet. */
export function defaultVesselFor(character?: { name?: string } | null): VesselConfig {
  const n = (character?.name || "").toLowerCase();
  const key = n.includes("serenity") ? "serenity" : n.includes("linda") ? "linda" : /aelin|aelynd/.test(n) ? "aelindra" : "";
  return parseVesselConfig(key ? VESSEL_PRESETS[key] : {});
}

const COLOR_NAMES: [string, number, number, number][] = [
  ["white", 245, 245, 245], ["silver", 200, 205, 215], ["black", 20, 20, 22], ["dark brown", 80, 50, 35],
  ["auburn", 140, 60, 35], ["copper", 190, 100, 50], ["blonde", 225, 195, 130], ["red", 200, 40, 40],
  ["pink", 236, 130, 170], ["violet", 150, 110, 240], ["blue", 50, 110, 230], ["cyan", 50, 220, 240],
  ["green", 60, 200, 110], ["gold", 212, 175, 55], ["orange", 240, 140, 60], ["navy", 40, 45, 110], ["charcoal", 35, 40, 50],
];
export function colorName(h: string): string {
  const v = parseInt(h.slice(1), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  let best = COLOR_NAMES[0], d = Infinity;
  for (const c of COLOR_NAMES) {
    const dd = (c[1] - r) ** 2 + (c[2] - g) ** 2 + (c[3] - b) ** 2;
    if (dd < d) { d = dd; best = c; }
  }
  return best[0];
}
function skinName(h: string): string {
  const v = parseInt(h.slice(1), 16);
  const lum = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  return lum > 200 ? "fair porcelain" : lum > 170 ? "light warm" : lum > 140 ? "medium olive-warm" : lum > 105 ? "tan brown" : "deep brown";
}

/** Serialize the vessel into photo-generator descriptor attributes (merged over the locked identity). */
export function vesselToPhotoDescriptor(c: VesselConfig): Partial<VisualDescriptor> {
  const marks: string[] = [];
  if (c.eyes.glow > 0.45) marks.push(`softly luminous ${colorName(c.eyes.color)} irises`);
  if (c.effects.aura !== "none") marks.push(`subtle ${colorName(c.effects.color)} ${c.effects.aura} light effect`);
  for (const a of c.accessories) marks.push(a.replace(/-/g, " "));
  return {
    skin_tone: skinName(c.skinTone),
    eye_color: colorName(c.eyes.color),
    hair_color: colorName(c.hair.color),
    hair_style: c.hair.style,
    body_type: c.bodyType,
    signature_outfit: `${colorName(c.outfit.color)} ${c.outfit.top} with ${colorName(c.outfit.accent)} accents and ${c.outfit.bottom}`,
    distinguishing_marks: marks.slice(0, 6),
  };
}

/** Flat phrases for the photo prompt's identity anchor (`extraDescriptor`). */
export function vesselToDescriptorPhrases(c: VesselConfig): string[] {
  const d = vesselToPhotoDescriptor(c);
  return [
    d.skin_tone && `${d.skin_tone} skin`,
    d.eye_color && `${d.eye_color} eyes`,
    d.hair_color && d.hair_style && `${d.hair_color} ${d.hair_style} hair`,
    d.body_type && `${d.body_type} build`,
    d.signature_outfit && `wearing a ${d.signature_outfit}`,
    ...(d.distinguishing_marks || []),
  ].filter(Boolean) as string[];
}
