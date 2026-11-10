import { useCallback, useEffect, useMemo, useState } from "react";
import { buildRegionContext, cellKey, snapToCell, type RegionContext } from "./region";
import { fetchWeather, type WeatherReading } from "./weather";

export const LOCATION_CHOICE_KEY = "anima.cyberworld.explore.location";
export type LocationChoice = "geo" | "timezone" | null;
export type RegionStatus = "timezone" | "locating" | "geo" | "denied" | "unsupported";

type Cell = { lat: number; lon: number; key: string; reading: WeatherReading };

function readChoice(): LocationChoice {
  try {
    const v = window.localStorage.getItem(LOCATION_CHOICE_KEY);
    return v === "geo" || v === "timezone" ? v : null;
  } catch {
    return null;
  }
}
function writeChoice(c: Exclude<LocationChoice, null>) {
  try {
    window.localStorage.setItem(LOCATION_CHOICE_KEY, c);
  } catch {
    /* ignore */
  }
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Opt-in real-world context. Location is requested only after the player
 * accepts the explainer (choice "geo"); coordinates are snapped to a ~50 km
 * cell in memory and dropped. Denied / unsupported → timezone fallback.
 */
export function useRegionContext() {
  const [choice, setChoice] = useState<LocationChoice>(readChoice);
  const [status, setStatus] = useState<RegionStatus>("timezone");
  const [cell, setCell] = useState<Cell | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const snapped = snapToCell(pos.coords.latitude, pos.coords.longitude);
        const key = cellKey(pos.coords.latitude, pos.coords.longitude);
        // Precise coords go out of scope here; only the snapped cell is kept.
        void fetchWeather(key, snapped.lat, snapped.lon).then((reading) => {
          setCell({ ...snapped, key, reading });
          setStatus("geo");
        });
      },
      () => setStatus("denied"),
      { enableHighAccuracy: false, maximumAge: 60 * 60 * 1000, timeout: 10_000 },
    );
  }, []);

  // Returning player who opted in: only re-locate silently if permission is already granted.
  useEffect(() => {
    if (choice !== "geo") return;
    let live = true;
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) {
      locate();
      return;
    }
    perms
      .query({ name: "geolocation" as PermissionName })
      .then((s) => live && (s.state === "granted" ? locate() : s.state === "denied" ? setStatus("denied") : undefined))
      .catch(() => live && locate());
    return () => {
      live = false;
    };
  }, [choice, locate]);

  const enableLocation = useCallback(() => {
    writeChoice("geo");
    setChoice("geo");
    locate();
  }, [locate]);

  const chooseTimezone = useCallback(() => {
    writeChoice("timezone");
    setChoice("timezone");
    setCell(null);
    setStatus("timezone");
  }, []);

  const region: RegionContext = useMemo(() => {
    if (status === "geo" && cell) {
      const r = buildRegionContext({ source: "geo", lat: cell.lat, lon: cell.lon, elevation: cell.reading.elevation, weather: cell.reading.weather }, now);
      return { ...r, key: cell.key };
    }
    return buildRegionContext({ source: "timezone", timezone: deviceTimezone() }, now);
  }, [status, cell, now]);

  return { region, status, choice, enableLocation, chooseTimezone };
}
