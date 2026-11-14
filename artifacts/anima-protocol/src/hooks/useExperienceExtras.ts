/**
 * Live view of the presentation-only Appearance Studio extras that 3D scenes
 * and gameplay HUDs need: character presentation, HUD style, reduced motion.
 * Source of truth is the <html> dataset written by experienceRuntime /
 * appearanceStudio, so this works inside R3F canvases too (no context needed).
 */
import { useSyncExternalStore } from "react";
import { readExperienceExtras, type ExperienceExtrasSnapshot } from "@/lib/vessel/presentation";

const WATCHED = ["data-experience-character", "data-experience-hud", "data-appearance-motion"];
let cached: ExperienceExtrasSnapshot | null = null;
let cachedKey = "";

function snapshot(): ExperienceExtrasSnapshot {
  const next = readExperienceExtras();
  const key = `${next.character}|${next.hud}|${next.reducedMotion}`;
  if (!cached || key !== cachedKey) {
    cached = next;
    cachedKey = key;
  }
  return cached;
}

const SERVER: ExperienceExtrasSnapshot = { character: "portrait", hud: "minimal", reducedMotion: false };

function subscribe(onChange: () => void) {
  if (typeof document === "undefined") return () => {};
  const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(onChange) : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: WATCHED });
  let mq: MediaQueryList | null = null;
  try {
    mq = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  } catch {
    mq = null;
  }
  mq?.addEventListener?.("change", onChange);
  return () => {
    mo?.disconnect();
    mq?.removeEventListener?.("change", onChange);
  };
}

export function useExperienceExtras(): ExperienceExtrasSnapshot {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER);
}
