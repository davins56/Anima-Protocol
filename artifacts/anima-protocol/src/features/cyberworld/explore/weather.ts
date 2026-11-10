/**
 * Optional weather via Open-Meteo (free, no key). Only ever called with
 * grid-snapped coordinates, cached per region cell for an hour; the cache
 * stores the cell id, WMO code and elevation — never coordinates.
 */
import { weatherFromWmo, type Weather } from "./region";

export const WEATHER_CACHE_KEY = "anima.cyberworld.explore.weather";
export const WEATHER_TTL_MS = 60 * 60 * 1000;

export type WeatherReading = { weather: Weather; elevation: number | null };
type Cached = { key: string; at: number; code: number | null; elevation: number | null };

export function openMeteoUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: "weather_code", timezone: "auto" });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function parseOpenMeteo(json: unknown): { code: number | null; elevation: number | null } {
  const j = (json ?? {}) as { current?: { weather_code?: unknown }; elevation?: unknown };
  const code = typeof j.current?.weather_code === "number" ? j.current.weather_code : null;
  const elevation = typeof j.elevation === "number" && Number.isFinite(j.elevation) ? j.elevation : null;
  return { code, elevation };
}

function readCache(key: string, now: number): Cached | null {
  try {
    const c = JSON.parse(window.localStorage.getItem(WEATHER_CACHE_KEY) || "null") as Cached | null;
    return c && c.key === key && now - c.at < WEATHER_TTL_MS ? c : null;
  } catch {
    return null;
  }
}

export async function fetchWeather(cellKey: string, lat: number, lon: number, now = Date.now(), fetcher: typeof fetch = fetch): Promise<WeatherReading> {
  const cached = readCache(cellKey, now);
  if (cached) return { weather: weatherFromWmo(cached.code), elevation: cached.elevation };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetcher(openMeteoUrl(lat, lon), { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { weather: "unknown", elevation: null };
    const { code, elevation } = parseOpenMeteo(await res.json());
    try {
      window.localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ key: cellKey, at: now, code, elevation } satisfies Cached));
    } catch {
      /* ignore */
    }
    return { weather: weatherFromWmo(code), elevation };
  } catch {
    return { weather: "unknown", elevation: null };
  }
}
