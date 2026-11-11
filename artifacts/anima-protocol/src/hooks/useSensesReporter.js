import { useEffect } from "react";
import {
  SENSES_REPORT_INTERVAL_MS,
  reportSenses,
  sensesOptedIn,
} from "@/lib/animaSenses";

/**
 * When the steward has opted in on this device, refresh the /api/senses
 * snapshot on sign-in, when the tab becomes visible, and on the existing
 * report interval. No-ops until setSensesOptIn(true).
 */
export function useSensesReporter(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const tick = () => {
      if (!cancelled && sensesOptedIn()) void reportSenses();
    };
    tick();
    const id = setInterval(tick, SENSES_REPORT_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}
