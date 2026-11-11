/**
 * Real-world signals → a coarse, privacy-first RegionContext.
 *
 * - Location is opt-in. Coordinates are snapped to a ~0.5° grid cell
 *   (~50 km) immediately; only an opaque cell id, the biome class and the
 *   weather/elevation summary are ever persisted (same rule as Echo Keys
 *   field attune: raw coordinates are never stored).
 * - Without location we fall back to the device timezone (a tiny lookup of
 *   approximate coordinates per zone / continent).
 * - Time of day and season come from the local clock (season flips south of
 *   the equator).
 */
import { classifyBiome, type BiomeId } from "./biomes";
import { hashString } from "./rng";

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export type Season = "spring" | "summer" | "autumn" | "winter";
export type Weather = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm" | "unknown";
export type RegionSource = "geo" | "timezone";

export type RegionContext = {
  source: RegionSource;
  /** Opaque, stable id for the region (cell hash or timezone). Safe to persist. */
  key: string;
  /** Human label, never precise coordinates. */
  label: string;
  /** Snapped/approximate coordinates — in memory only, never persisted. */
  lat: number;
  lon: number;
  elevation: number | null;
  biome: BiomeId;
  timeOfDay: TimeOfDay;
  season: Season;
  weather: Weather;
  /** Local calendar day, YYYY-MM-DD — spawns reseed daily. */
  dayKey: string;
};

/** ~0.5° ≈ 55 km — "roughly city-level". */
export const CELL_DEGREES = 0.5;

export function snapToCell(lat: number, lon: number, step = CELL_DEGREES): { lat: number; lon: number } {
  const s = (v: number) => Math.round((Math.floor(v / step) * step + step / 2) * 1000) / 1000;
  return { lat: s(lat), lon: s(lon) };
}

export function cellKey(lat: number, lon: number): string {
  const c = snapToCell(lat, lon);
  return `cell-${hashString(`${c.lat},${c.lon}`).toString(36)}`;
}

/** Approximate coordinates for common timezones; falls back per continent prefix. */
const TZ_COORDS: Record<string, readonly [number, number]> = {
  "America/New_York": [40.7, -74],
  "America/Chicago": [41.9, -87.6],
  "America/Denver": [39.7, -105],
  "America/Phoenix": [33.4, -112],
  "America/Los_Angeles": [34, -118.2],
  "America/Anchorage": [61.2, -149.9],
  "America/Toronto": [43.7, -79.4],
  "America/Vancouver": [49.3, -123.1],
  "America/Mexico_City": [19.4, -99.1],
  "America/Sao_Paulo": [-23.5, -46.6],
  "America/Argentina/Buenos_Aires": [-34.6, -58.4],
  "America/Santiago": [-33.4, -70.6],
  "America/Lima": [-12, -77],
  "Pacific/Honolulu": [21.3, -157.9],
  "Europe/London": [51.5, -0.1],
  "Europe/Paris": [48.9, 2.35],
  "Europe/Berlin": [52.5, 13.4],
  "Europe/Madrid": [40.4, -3.7],
  "Europe/Rome": [41.9, 12.5],
  "Europe/Moscow": [55.8, 37.6],
  "Europe/Zurich": [47.4, 8.5],
  "Europe/Oslo": [59.9, 10.8],
  "Atlantic/Reykjavik": [64.1, -21.9],
  "Africa/Cairo": [30, 31.2],
  "Africa/Lagos": [6.5, 3.4],
  "Africa/Nairobi": [-1.3, 36.8],
  "Africa/Johannesburg": [-26.2, 28],
  "Asia/Dubai": [25.2, 55.3],
  "Asia/Riyadh": [24.7, 46.7],
  "Asia/Kolkata": [19.1, 72.9],
  "Asia/Shanghai": [31.2, 121.5],
  "Asia/Hong_Kong": [22.3, 114.2],
  "Asia/Tokyo": [35.7, 139.7],
  "Asia/Seoul": [37.6, 127],
  "Asia/Singapore": [1.35, 103.8],
  "Asia/Kathmandu": [27.7, 85.3],
  "Asia/Ulaanbaatar": [47.9, 106.9],
  "Australia/Sydney": [-33.9, 151.2],
  "Australia/Perth": [-31.95, 115.9],
  "Australia/Alice_Springs": [-23.7, 133.9],
  "Pacific/Auckland": [-36.85, 174.8],
  "Antarctica/McMurdo": [-77.8, 166.7],
  "Arctic/Longyearbyen": [78.2, 15.6],
  UTC: [51.5, -0.1],
};
const TZ_PREFIX: Record<string, readonly [number, number]> = {
  America: [39, -95],
  Europe: [50, 10],
  Africa: [5, 20],
  Asia: [30, 100],
  Australia: [-30, 140],
  Pacific: [-15, -170],
  Atlantic: [40, -30],
  Indian: [-10, 75],
  Antarctica: [-78, 0],
  Arctic: [78, 15],
};

export function coordsFromTimezone(tz: string | null | undefined): { lat: number; lon: number } {
  const z = tz || "UTC";
  const hit = TZ_COORDS[z] ?? TZ_PREFIX[z.split("/")[0]] ?? TZ_COORDS.UTC;
  return { lat: hit[0], lon: hit[1] };
}

export function timeOfDay(date: Date): TimeOfDay {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5 && h < 7.5) return "dawn";
  if (h >= 7.5 && h < 17.5) return "day";
  if (h >= 17.5 && h < 20.5) return "dusk";
  return "night";
}

export function seasonFor(date: Date, lat: number): Season {
  const north: Season[] = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
  const s = north[date.getMonth()];
  if (lat >= 0) return s;
  return ({ winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" } as const)[s];
}

export function dayKeyFor(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** WMO weather interpretation codes (Open-Meteo `weather_code`) → coarse weather. */
export function weatherFromWmo(code: number | null | undefined): Weather {
  if (code == null || !Number.isFinite(code)) return "unknown";
  if (code <= 1) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

export type RegionInput =
  | { source: "geo"; lat: number; lon: number; elevation?: number | null; weather?: Weather }
  | { source: "timezone"; timezone: string | null | undefined };

/** Pure: build the context from already-coarsened inputs + a clock. */
export function buildRegionContext(input: RegionInput, now: Date): RegionContext {
  let lat: number, lon: number, key: string, label: string, elevation: number | null = null, weather: Weather = "unknown";
  if (input.source === "geo") {
    const c = snapToCell(input.lat, input.lon);
    lat = c.lat;
    lon = c.lon;
    key = cellKey(input.lat, input.lon);
    elevation = input.elevation ?? null;
    weather = input.weather ?? "unknown";
    label = "Your area (approx.)";
  } else {
    const tz = input.timezone || "UTC";
    ({ lat, lon } = coordsFromTimezone(tz));
    key = `tz-${tz}`;
    label = tz.replace(/_/g, " ").split("/").pop() || tz;
  }
  return {
    source: input.source,
    key,
    label,
    lat,
    lon,
    elevation,
    biome: classifyBiome({ lat, lon, elevation }),
    timeOfDay: timeOfDay(now),
    season: seasonFor(now, lat),
    weather,
    dayKey: dayKeyFor(now),
  };
}
