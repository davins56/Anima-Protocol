import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function media(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
  } catch {
    return null;
  }
}

function subscribe(fn: () => void) {
  const m = media();
  if (!m) return () => {};
  if (typeof m.addEventListener === "function") {
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }
  m.addListener?.(fn);
  return () => m.removeListener?.(fn);
}

const snapshot = () => Boolean(media()?.matches);

/** Live `prefers-reduced-motion: reduce` (updates when the OS setting flips). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
