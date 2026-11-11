/**
 * Region biomes: what kind of "net" your real-world area projects into the
 * cyberworld. Deterministic heuristics from coarse lat/lon/elevation plus a
 * tiny lookup of metro and desert boxes — no external geodata.
 */

export type BiomeId = "urban" | "coastal" | "forest" | "desert" | "mountain" | "polar";

export type Biome = {
  id: BiomeId;
  label: string;
  blurb: string;
  /** Tints applied to the area (grid + light). */
  accent: string;
  gridCell: string;
  gridSection: string;
  glyph: string;
};

export const BIOMES: Record<BiomeId, Biome> = {
  urban: { id: "urban", label: "Urban Grid", blurb: "Dense traffic nets: caches, ads and lost packets everywhere.", accent: "#FACC15", gridCell: "#3a330e", gridSection: "#a16207", glyph: "▦" },
  coastal: { id: "coastal", label: "Coastal Stream", blurb: "Data tides wash fragments up along the shoreline buffers.", accent: "#38BDF8", gridCell: "#0c2f45", gridSection: "#0369a1", glyph: "≈" },
  forest: { id: "forest", label: "Forest Mesh", blurb: "Organic code grows in branching trees; old seeds sprout here.", accent: "#34D399", gridCell: "#0d3324", gridSection: "#047857", glyph: "♣" },
  desert: { id: "desert", label: "Desert Archive", blurb: "Sun-bleached sectors hide buried archives and glass shards.", accent: "#F59E0B", gridCell: "#3d2a0a", gridSection: "#b45309", glyph: "◬" },
  mountain: { id: "mountain", label: "Highland Relay", blurb: "Thin air, strong signal: relay towers and echo crystals.", accent: "#A78BFA", gridCell: "#241a45", gridSection: "#6d28d9", glyph: "▲" },
  polar: { id: "polar", label: "Polar Cold Storage", blurb: "Frozen backups and aurora-charged cores sleep in the ice.", accent: "#E0F2FE", gridCell: "#1e3a4a", gridSection: "#7dd3fc", glyph: "❄" },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

type Box = readonly [latMin: number, latMax: number, lonMin: number, lonMax: number];

/** Major metro areas (≈ ±0.6°). Coarse on purpose. */
const METROS: ReadonlyArray<readonly [number, number]> = [
  [40.7, -74], [34, -118.2], [41.9, -87.6], [29.8, -95.4], [33.7, -84.4], [37.8, -122.4], [47.6, -122.3], [43.7, -79.4], [45.5, -73.6], [19.4, -99.1],
  [-23.5, -46.6], [-34.6, -58.4], [51.5, -0.1], [48.9, 2.35], [52.5, 13.4], [40.4, -3.7], [41.9, 12.5], [55.8, 37.6], [41, 29], [30, 31.2],
  [6.5, 3.4], [25.2, 55.3], [19.1, 72.9], [28.6, 77.2], [31.2, 121.5], [39.9, 116.4], [22.3, 114.2], [35.7, 139.7], [37.6, 127], [1.35, 103.8],
  [13.75, 100.5], [-6.2, 106.8], [14.6, 121], [-33.9, 151.2], [-37.8, 145],
];
const DESERTS: readonly Box[] = [
  [15, 32, -15, 35], // Sahara
  [15, 32, 35, 60], // Arabia
  [25, 37, -117, -103], // SW US / N Mexico
  [-30, -18, -71, -68], // Atacama
  [-32, -20, 120, 142], // Australian interior
  [38, 46, 95, 112], // Gobi
  [24, 30, 68, 74], // Thar
  [-28, -17, 15, 22], // Kalahari/Namib
];

const inBox = (lat: number, lon: number, b: Box) => lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3];

export function classifyBiome({ lat, lon, elevation }: { lat: number; lon: number; elevation?: number | null }): BiomeId {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "forest";
  if (Math.abs(lat) >= 64) return "polar";
  if (METROS.some(([mlat, mlon]) => Math.abs(lat - mlat) <= 0.6 && Math.abs(lon - mlon) <= 0.6)) return "urban";
  if (elevation != null && elevation >= 1400) return "mountain";
  if (DESERTS.some((b) => inBox(lat, lon, b))) return "desert";
  if (elevation != null && elevation <= 15) return "coastal";
  // Without elevation data, a deterministic sprinkle keeps non-metro regions varied.
  if (elevation == null) {
    const h = Math.abs(Math.round(lat * 2) * 31 + Math.round(lon * 2) * 17) % 5;
    if (h === 0) return "coastal";
    if (h === 1 && Math.abs(lat) > 30) return "mountain";
  }
  return "forest";
}

/** Darken/brighten the area tint by time of day. */
export function biomeTint(biome: BiomeId, tod: "dawn" | "day" | "dusk" | "night"): { accent: string; gridCell: string; gridSection: string; fog: string; light: number } {
  const b = BIOMES[biome];
  const fog = tod === "night" ? "#03020a" : tod === "dusk" ? "#120818" : tod === "dawn" ? "#0b0a18" : "#07060D";
  const light = tod === "night" ? 0.55 : tod === "day" ? 1.15 : 0.85;
  return { accent: b.accent, gridCell: b.gridCell, gridSection: b.gridSection, fog, light };
}
