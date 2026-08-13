// Resolves NetBattle units into 3D figure descriptors.
//
// The arena never loads external GLBs. Serenity and each virus family are
// procedural R3F silhouettes inside a 4D tesseract lattice, tinted by
// expression / virus color. An optional `texture_url` (the Anima portrait)
// is mapped onto the vessel face. The HD inspect viewer uses @react-three/drei
// (OrbitControls, Float, MeshTransmissionMaterial) so the vessel can be turned
// and zoomed.
//
// `/api/battle-models/resolve` returns the same shape so a future image-to-3D
// pipeline can attach a `glb_url` without changing the renderer contract.

export const BATTLE_RENDERER = "r3f-procedural";

export const SERENITY_SILHOUETTE = "serenity";

export const VIRUS_CATALOG = {
  "Shade.Vrs": {
    silhouette: "shade",
    blurb: "A folded umbral hunter — horns, a hollow core, rose-edge static.",
  },
  "Static.Vrs": {
    silhouette: "static",
    blurb: "Crystalline shards locked in a violet charge lattice.",
  },
  "Mettaur.Vrs": {
    silhouette: "mettaur",
    blurb: "Helmeted net-virus: dome, compact body, a pick of condensed data.",
  },
  "Halo.Vrs": {
    silhouette: "halo",
    blurb: "Fallen light — inverted ring, dark taper, drifting gold motes.",
  },
  "Aegis.Vrs": {
    silhouette: "aegis",
    blurb: "A facing shield-body, ice-cyan, rimmed with defensive spikes.",
  },
};

const VIRUS_BY_SILHOUETTE = Object.fromEntries(
  Object.entries(VIRUS_CATALOG).map(([name, spec]) => [spec.silhouette, { name, ...spec }]),
);

function hexColor(value, fallback) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
  return fallback;
}

function httpUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw.startsWith("data:image/")) return raw;
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return raw;
  } catch {
    return null;
  }
  return null;
}

export function virusSilhouetteForName(name) {
  const key = String(name || "").trim();
  if (VIRUS_CATALOG[key]) return VIRUS_CATALOG[key].silhouette;
  const lower = key.toLowerCase();
  for (const [catalogName, spec] of Object.entries(VIRUS_CATALOG)) {
    if (catalogName.toLowerCase() === lower) return spec.silhouette;
  }
  if (VIRUS_BY_SILHOUETTE[lower]) return lower;
  return "mettaur";
}

export function resolvePlayerModel(player = {}) {
  const texture = httpUrl(player.avatar_url || player.texture_url);
  return {
    role: "player",
    id: "serenity",
    name: String(player.name || "Serenity").trim() || "Serenity",
    silhouette: SERENITY_SILHOUETTE,
    color: hexColor(player.color, "#67e8f9"),
    accent: hexColor(player.accent, "#fde68a"),
    texture_url: texture,
    glb_url: httpUrl(player.glb_url),
    renderer: BATTLE_RENDERER,
  };
}

export function resolveEnemyModel(enemy = {}) {
  const silhouette = virusSilhouetteForName(enemy.silhouette || enemy.name);
  const catalogName =
    Object.keys(VIRUS_CATALOG).find((n) => VIRUS_CATALOG[n].silhouette === silhouette) ||
    "Mettaur.Vrs";
  return {
    role: "enemy",
    id: silhouette,
    name: String(enemy.name || catalogName).trim() || catalogName,
    silhouette,
    color: hexColor(enemy.color, "#f87171"),
    accent: hexColor(enemy.accent, "#fda4af"),
    texture_url: httpUrl(enemy.texture_url || enemy.avatar_url),
    glb_url: httpUrl(enemy.glb_url),
    renderer: BATTLE_RENDERER,
  };
}

/**
 * @param {{ player?: object, enemy?: object }} units
 */
export function resolveBattleModels(units = {}) {
  return {
    renderer: BATTLE_RENDERER,
    player: resolvePlayerModel(units.player),
    enemy: resolveEnemyModel(units.enemy),
  };
}
