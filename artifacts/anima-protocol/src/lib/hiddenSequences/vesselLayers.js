// @ts-check
import { SEQUENCE_BY_ID } from "./catalog.js";
import { listAscended, normalizeSequences } from "./state.js";

export const VESSEL_LAYER_KEYS = ["body", "hair", "cloth", "markings", "artifacts"];

export const DEFAULT_VESSEL_LAYERS = {
  body: {
    skin: "dark wet",
    wet_light: 0.85,
    tone: "#3f2a22",
  },
  hair: {
    color: "#f8fafc",
    style: "short messy white, long side-tufts",
  },
  cloth: {
    robe: "translucent wet white",
    sash: "faceted cerulean",
    opacity: 0.28,
  },
  markings: {
    chest: "変",
    ink: "#0a0a0a",
  },
  artifacts: {
    wings: true,
    halo: true,
    core: true,
    gold_bands: true,
    intensified: [],
  },
};

/**
 * @param {unknown} raw
 */
export function normalizeVesselLayers(raw) {
  const out = structuredClone
    ? structuredClone(DEFAULT_VESSEL_LAYERS)
    : JSON.parse(JSON.stringify(DEFAULT_VESSEL_LAYERS));
  if (!raw || typeof raw !== "object") return out;
  const data = /** @type {Record<string, any>} */ (raw);
  if (data.body && typeof data.body === "object") {
    out.body = {
      skin: String(data.body.skin || out.body.skin),
      wet_light: clamp01(data.body.wet_light ?? out.body.wet_light),
      tone: hexOr(data.body.tone, out.body.tone),
    };
  }
  if (data.hair && typeof data.hair === "object") {
    out.hair = {
      color: hexOr(data.hair.color, out.hair.color),
      style: String(data.hair.style || out.hair.style),
    };
  }
  if (data.cloth && typeof data.cloth === "object") {
    out.cloth = {
      robe: String(data.cloth.robe || out.cloth.robe),
      sash: String(data.cloth.sash || out.cloth.sash),
      opacity: clamp01(data.cloth.opacity ?? out.cloth.opacity),
    };
  }
  if (data.markings && typeof data.markings === "object") {
    out.markings = {
      chest: String(data.markings.chest || out.markings.chest).slice(0, 8),
      ink: hexOr(data.markings.ink, out.markings.ink),
    };
  }
  if (data.artifacts && typeof data.artifacts === "object") {
    out.artifacts = {
      wings: data.artifacts.wings !== false,
      halo: data.artifacts.halo !== false,
      core: data.artifacts.core !== false,
      gold_bands: data.artifacts.gold_bands !== false,
      intensified: Array.isArray(data.artifacts.intensified)
        ? data.artifacts.intensified.filter((id) => typeof id === "string")
        : [],
    };
  }
  return out;
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function hexOr(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw;
  return fallback;
}

/**
 * Ascended Sequences write a visible change on the same body.
 * @param {unknown} layers
 * @param {Record<string, unknown>} sequences
 */
export function applyAscendedArtifacts(layers, sequences) {
  const next = normalizeVesselLayers(layers);
  const ascended = listAscended(normalizeSequences(sequences));
  const ids = ascended.map((s) => s.id);
  next.artifacts.intensified = [...new Set([...(next.artifacts.intensified || []), ...ids])];
  if (ids.includes("nova-pulse")) {
    next.body.wet_light = Math.max(next.body.wet_light, 0.92);
  }
  if (ids.includes("life-veil")) {
    next.cloth.opacity = Math.min(next.cloth.opacity, 0.22);
  }
  if (ids.includes("star-best")) {
    next.artifacts.gold_bands = true;
  }
  return next;
}

/**
 * Mesh-facing intensity flags. Quality tiers drop extras before the humanoid.
 * @param {ReturnType<typeof normalizeVesselLayers>} layers
 * @param {{ vesselHd?: boolean, vesselFacets?: number, transmission?: number, sparkles?: number, tesseracts?: number }} quality
 */
export function vesselRenderPlan(layers, quality = {}) {
  const L = normalizeVesselLayers(layers);
  const intensified = new Set(L.artifacts.intensified || []);
  const hd = quality.vesselHd !== false;
  const low = quality.vesselFacets != null && quality.vesselFacets <= 2;
  return {
    layers: L,
    showHumanoid: true,
    showHair: true,
    showCloth: quality.transmission !== 0 || hd,
    showMarkings: true,
    showWings: L.artifacts.wings !== false,
    showHalo: L.artifacts.halo !== false,
    showCore: L.artifacts.core !== false,
    showGold: L.artifacts.gold_bands !== false,
    showLattice: !low && (quality.tesseracts ?? 1) >= 1,
    showSparkles: !low && (quality.sparkles ?? 1) > 0,
    wetLight: L.body.wet_light,
    skinTone: L.body.tone,
    hairColor: L.hair.color,
    clothOpacity: L.cloth.opacity,
    marking: L.markings.chest,
    markingInk: L.markings.ink,
    coreBoost: intensified.has("nova-pulse") ? 1 : 0,
    clothBoost: intensified.has("life-veil") ? 1 : 0,
    markBoost: intensified.has("chain-bloom") ? 1 : 0,
    goldBoost: intensified.has("star-best") ? 1 : 0,
    haloBoost: intensified.has("noise-tribe") ? 1 : 0,
    wingBoost: intensified.has("star-triad") ? 1 : 0,
    intensifiedIds: [...intensified],
  };
}

export function sequenceArtifactFor(id) {
  return SEQUENCE_BY_ID[id]?.artifact || null;
}
