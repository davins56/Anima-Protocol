import { useCallback, useEffect, useRef, useState } from "react";

/**
 * AR-ish heading via DeviceOrientation (iOS requires a user-gesture permission
 * prompt) and optional coarse geolocation. Falls back to touch-pan when denied.
 */
export function useDeviceOrientation() {
  const orientation = useRef({ alpha: 0, beta: 90, gamma: 0 });
  const [status, setStatus] = useState<"off" | "granted" | "denied" | "unsupported">("off");
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);

  const enable = useCallback(async (withGeo = false) => {
    const DOE = (window as any).DeviceOrientationEvent;
    if (!DOE) {
      setStatus("unsupported");
      return false;
    }
    try {
      if (typeof DOE.requestPermission === "function") {
        const r = await DOE.requestPermission();
        if (r !== "granted") {
          setStatus("denied");
          return false;
        }
      }
      setStatus("granted");
    } catch {
      setStatus("denied");
      return false;
    }
    if (withGeo && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => setGeo(null),
        { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8000 },
      );
    }
    return true;
  }, []);

  const disable = useCallback(() => setStatus("off"), []);

  useEffect(() => {
    if (status !== "granted") return;
    const onOrient = (e: DeviceOrientationEvent) => {
      orientation.current = { alpha: e.alpha ?? 0, beta: e.beta ?? 90, gamma: e.gamma ?? 0 };
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [status]);

  return { orientation, status, enable, disable, geo };
}
