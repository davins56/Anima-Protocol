/**
 * Lifelike vessel bases: high-detail rigged humanoids (MakeHuman CC0 base mesh,
 * built headless in Blender by scripts/vessel-lifelike/) bundled under
 * public/vessels/. They load through the normal `model.kind = "gltf"` slot.
 *
 * The saved URL is the canonical https one (passes the config schema and, when
 * `VESSEL_MODEL_URL_HOSTS` lists the app host, the server whitelist); rendering
 * always maps it back to the same-origin bundled file, so dev, previews and
 * production all load the local asset and never a third-party host.
 */
import type { VesselConfig } from "./vesselConfig";
import { SERENITY_ANGELIC, VESSEL_PRESETS } from "./vesselConfig";

export const LIFELIKE_CANONICAL_ORIGIN = "https://anima-protocol.com";
const PATH_RE = /^\/vessels\/([a-z0-9-]{1,40})-lifelike\.glb$/;
const TRUSTED_HOSTS = new Set(["anima-protocol.com", "www.anima-protocol.com"]);

export type LifelikeBaseKey = "serenity" | "scarlet";

export const LIFELIKE_BASES: Record<LifelikeBaseKey, { label: string; file: string; look: Partial<VesselConfig> }> = {
  // Serenity's approved look is her angelic form (short white hair, white robe, blue sash, wings, halo).
  serenity: { label: "Serenity · lifelike", file: "/vessels/serenity-lifelike.glb", look: SERENITY_ANGELIC },
  scarlet: {
    label: "Scarlet · lifelike",
    file: "/vessels/scarlet-lifelike.glb",
    look: {
      ...VESSEL_PRESETS.scarlet,
      skinTone: "#cf9774",
      hair: { style: "wild", color: "#9a0f17" },
      eyes: { color: "#b8742c", glow: 0.15 },
      outfit: { top: "dress", bottom: "skirt", color: "#0b0909", accent: "#8b0f1a" },
      accessories: ["earrings"],
      effects: { aura: "none", glow: 0.35, particles: 0, color: "#f97316" },
    },
  },
};

export function hasLifelikeBase(base: string | undefined | null): base is LifelikeBaseKey {
  return base === "serenity" || base === "scarlet";
}

/** The model slot value for a lifelike base (canonical https URL). */
export function lifelikeModelFor(base: LifelikeBaseKey): VesselConfig["model"] {
  return { kind: "gltf", url: `${LIFELIKE_CANONICAL_ORIGIN}${LIFELIKE_BASES[base].file}`, format: "glb", humanoid: true };
}

/** Config with the lifelike base for `base` applied (look + model slot). */
export function withLifelikeBase(config: VesselConfig, base: LifelikeBaseKey): VesselConfig {
  const look = LIFELIKE_BASES[base].look;
  return { ...config, ...look, base, model: lifelikeModelFor(base) } as VesselConfig;
}

/**
 * Same-origin path of a bundled lifelike base for a stored model URL, or null.
 * Accepts the bare path, the canonical/trusted host, or the current origin.
 */
export function lifelikeAssetPath(url: string | undefined | null, currentOrigin?: string): string | null {
  if (!url || typeof url !== "string") return null;
  if (PATH_RE.test(url)) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  const origin = currentOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const trusted = (u.protocol === "https:" && TRUSTED_HOSTS.has(u.hostname.toLowerCase())) || (origin && u.origin === origin);
  if (!trusted || !PATH_RE.test(u.pathname)) return null;
  return u.pathname;
}

export function isLifelikeModel(model: VesselConfig["model"] | undefined | null): boolean {
  return Boolean(model && model.kind === "gltf" && lifelikeAssetPath(model.url));
}
