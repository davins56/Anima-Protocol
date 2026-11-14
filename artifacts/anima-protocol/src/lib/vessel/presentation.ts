/**
 * Character presentation → 3D treatment (pure; no three.js import).
 *
 * The Appearance Studio "Character presentation" setting (experiencePresets
 * `character`: portrait | hologram | netnavi) is applied to <html> as
 * `data-experience-character` by experienceRuntime. Chat avatars read it in
 * CSS; the 3D vessel renderers (VesselModel, AnimaVesselMesh) read it through
 * useExperienceExtras and turn it into one of these treatments, which
 * PresentationTreatment applies to the materials of the vessel subtree.
 *
 * Budget rules (iPad Safari, see #728/#729): treatments are shader tweaks on
 * the existing materials plus, at most, one back-face outline shell per opaque
 * mesh. No extra WebGL contexts, render targets or post-processing. The
 * outline is dropped on the low quality tier and on crowded scenes (`lite`),
 * and the hologram scan only drifts when motion is allowed.
 */
export type CharacterPresentation = "portrait" | "hologram" | "netnavi";
export const CHARACTER_PRESENTATIONS: readonly CharacterPresentation[] = ["portrait", "hologram", "netnavi"];

export type HudStyle = "minimal" | "battle-network" | "tactical";
export const HUD_STYLES: readonly HudStyle[] = ["minimal", "battle-network", "tactical"];

export type PresentationTreatment = {
  option: CharacterPresentation;
  /** Fresnel rim added to the emissive term of lit materials. */
  rim: { color: string; strength: number; power: number } | null;
  /** Hologram projection: tint toward `tint`, see-through alpha, horizontal scan bands. */
  hologram: { tint: string; mix: number; alpha: number; scan: number; drift: boolean } | null;
  /** Inverted-hull outline, thickness as a fraction of view depth (screen-constant-ish). */
  outline: { color: string; width: number } | null;
};

/** Default cyan used by the chat avatar treatment (index.css: rgba(34,211,238,…)). */
export const PRESENTATION_CYAN = "#22d3ee";

export function normalizePresentation(value: unknown): CharacterPresentation {
  return CHARACTER_PRESENTATIONS.includes(value as CharacterPresentation) ? (value as CharacterPresentation) : "portrait";
}

export function normalizeHudStyle(value: unknown): HudStyle {
  return HUD_STYLES.includes(value as HudStyle) ? (value as HudStyle) : "minimal";
}

export type TreatmentContext = {
  /** Quality tier name from useRendererQuality ("low" | "medium" | "high"). */
  tier?: string;
  /** Crowded or tiny views (portrait thumbnails, many residents): no outline shells. */
  lite?: boolean;
  reducedMotion?: boolean;
  /** Accent to use instead of the default cyan (e.g. the vessel's own glow colour). */
  accent?: string | null;
};

/**
 * Map an option to its 3D treatment.
 * - portrait: the vessel as authored (no change), matching the plain round chat avatar.
 * - hologram: translucent cyan projection with a bright Fresnel edge and scan bands,
 *   matching the glowing circular chat avatar.
 * - netnavi:  solid "navi" read: crisp cyan outline + rim light, matching the
 *   square, outlined chat avatar. Outline omitted on low tier / lite views.
 */
export function presentationTreatment(option: unknown, ctx: TreatmentContext = {}): PresentationTreatment {
  const o = normalizePresentation(option);
  const color = ctx.accent || PRESENTATION_CYAN;
  const low = ctx.tier === "low";
  if (o === "hologram") {
    return {
      option: o,
      rim: { color, strength: low ? 1.1 : 1.4, power: 2.2 },
      hologram: { tint: color, mix: 0.55, alpha: 0.78, scan: low ? 0.12 : 0.18, drift: !ctx.reducedMotion },
      outline: null,
    };
  }
  if (o === "netnavi") {
    return {
      option: o,
      rim: { color, strength: low || ctx.lite ? 0.9 : 0.55, power: 3 },
      hologram: null,
      outline: low || ctx.lite ? null : { color, width: 0.0035 },
    };
  }
  return { option: o, rim: null, hologram: null, outline: null };
}

/** True when the treatment changes nothing (lets renderers skip all work). */
export function isIdentityTreatment(t: PresentationTreatment): boolean {
  return !t.rim && !t.hologram && !t.outline;
}

/** Stable key for the shader variant (customProgramCacheKey). */
export function treatmentKey(t: PresentationTreatment): string {
  return `anima-pres:${t.option}:${t.rim ? 1 : 0}${t.hologram ? 1 : 0}`;
}

export function prefersReducedMotion(doc: Document | undefined = globalThis.document, win: Window | undefined = globalThis.window): boolean {
  if (doc?.documentElement?.dataset?.appearanceMotion === "reduced") return true;
  try {
    return Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  } catch {
    return false;
  }
}

export type ExperienceExtrasSnapshot = { character: CharacterPresentation; hud: HudStyle; reducedMotion: boolean };

export function readExperienceExtras(doc: Document | undefined = globalThis.document, win: Window | undefined = globalThis.window): ExperienceExtrasSnapshot {
  const ds = doc?.documentElement?.dataset;
  return {
    character: normalizePresentation(ds?.experienceCharacter),
    hud: normalizeHudStyle(ds?.experienceHud),
    reducedMotion: prefersReducedMotion(doc, win),
  };
}
