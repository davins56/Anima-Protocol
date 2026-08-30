/**
 * Resolves NetBattle units into 3D figure descriptors.
 *
 * The frontend renders these as procedural R3F silhouettes (Serenity + viruses).
 * This module is the API-side contract so `/api/battle-models/resolve` can later
 * attach a generated `glb_url` without changing the client.
 */

export const BATTLE_RENDERER = "r3f-procedural" as const;

export const SERENITY_SILHOUETTE = "serenity" as const;

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
} as const;

export type VirusName = keyof typeof VIRUS_CATALOG;
export type VirusSilhouette = (typeof VIRUS_CATALOG)[VirusName]["silhouette"];

export type BattleUnitInput = {
  name?: string;
  color?: string;
  accent?: string;
  avatar_url?: string;
  texture_url?: string;
  glb_url?: string;
  silhouette?: string;
};

export type BattleFigureModel = {
  role: "player" | "enemy";
  id: string;
  name: string;
  silhouette: string;
  color: string;
  accent: string;
  texture_url: string | null;
  glb_url: string | null;
  renderer: typeof BATTLE_RENDERER;
};

function hexColor(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
  return fallback;
}

function httpUrl(value: unknown): string | null {
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

export function virusSilhouetteForName(name: unknown): VirusSilhouette {
  const key = String(name || "").trim();
  if (key in VIRUS_CATALOG) {
    return VIRUS_CATALOG[key as VirusName].silhouette;
  }
  const lower = key.toLowerCase();
  for (const [catalogName, spec] of Object.entries(VIRUS_CATALOG)) {
    if (catalogName.toLowerCase() === lower) return spec.silhouette;
  }
  const silhouettes = Object.values(VIRUS_CATALOG).map((s) => s.silhouette);
  if ((silhouettes as string[]).includes(lower)) {
    return lower as VirusSilhouette;
  }
  return "mettaur";
}

export function resolvePlayerModel(player: BattleUnitInput = {}): BattleFigureModel {
  return {
    role: "player",
    id: "serenity",
    name: String(player.name || "Serenity").trim() || "Serenity",
    silhouette: SERENITY_SILHOUETTE,
    color: hexColor(player.color, "#67e8f9"),
    accent: hexColor(player.accent, "#fde68a"),
    texture_url: httpUrl(player.avatar_url || player.texture_url),
    glb_url: httpUrl(player.glb_url),
    renderer: BATTLE_RENDERER,
  };
}

export function resolveEnemyModel(enemy: BattleUnitInput = {}): BattleFigureModel {
  const silhouette = virusSilhouetteForName(enemy.silhouette || enemy.name);
  const catalogName =
    (Object.keys(VIRUS_CATALOG) as VirusName[]).find(
      (n) => VIRUS_CATALOG[n].silhouette === silhouette,
    ) || "Mettaur.Vrs";
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

export function resolveBattleModels(units: {
  player?: BattleUnitInput;
  enemy?: BattleUnitInput;
} = {}) {
  return {
    renderer: BATTLE_RENDERER,
    player: resolvePlayerModel(units.player),
    enemy: resolveEnemyModel(units.enemy),
  };
}
