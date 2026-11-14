// @ts-check
import { useSyncExternalStore } from "react";
import { NAV_RAIL_MEDIA, effectiveNavPattern, readNavPatternSetting } from "@/lib/navigationPattern";

function wideNow() {
  try {
    return Boolean(globalThis.matchMedia?.(NAV_RAIL_MEDIA)?.matches);
  } catch {
    return false;
  }
}

function snapshot() {
  return effectiveNavPattern(readNavPatternSetting(), { wide: wideNow() });
}

/** @param {() => void} onChange */
function subscribe(onChange) {
  if (typeof document === "undefined") return () => {};
  const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(onChange) : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-experience-navigation"] });
  /** @type {MediaQueryList | null} */
  let mq = null;
  try {
    mq = globalThis.matchMedia?.(NAV_RAIL_MEDIA) ?? null;
  } catch {
    mq = null;
  }
  mq?.addEventListener?.("change", onChange);
  return () => {
    mo?.disconnect();
    mq?.removeEventListener?.("change", onChange);
  };
}

/**
 * Effective navigation mechanic for this device right now ("tabs" | "rail" |
 * "command"). Follows Appearance Studio and the viewport width live.
 */
export function useNavigationPattern() {
  return useSyncExternalStore(subscribe, snapshot, () => "tabs");
}
