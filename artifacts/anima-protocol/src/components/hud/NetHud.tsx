/**
 * NetNavi-inspired HUD for gameplay and network surfaces (Appearance Studio
 * "NetNavi interface": minimal | battle-network | tactical).
 *
 * Chat already reads `html[data-experience-hud]` in index.css. Gameplay and
 * network surfaces opt in with data attributes styled by ./netHud.css:
 *   data-net-hud="<surface>"        surface root (cyberworld, netbattle, arena, network)
 *   data-net-hud-panel              HUD panels (chamfered PET panels / tactical brackets)
 *   data-net-hud-panel="toolbar"    button strips (accent only, no chamfer)
 *   data-hud-character              character name / identity in a HUD (follows Character presentation)
 *   data-hud-character-avatar       character image in a HUD (same treatment as chat avatars)
 * and render <NetHudFrame> once for the decorative bezel + surface label.
 *
 * Pure CSS + one absolutely-positioned overlay: no canvases, no WebGL, no
 * timers. The only animation (battle-network sweep) is off under reduced motion.
 */
import { useExperienceExtras } from "@/hooks/useExperienceExtras";
import type { HudStyle } from "@/lib/vessel/presentation";
import "./netHud.css";

export type NetHudSurface = "cyberworld" | "netbattle" | "arena" | "network";

const SURFACE_LABEL: Record<NetHudSurface, string> = {
  cyberworld: "Cyberworld",
  netbattle: "NetBattle",
  arena: "Resonance arena",
  network: "Net",
};

/** Label shown on the bezel for each HUD style (null = no frame). */
export function netHudLabel(style: HudStyle, surface: NetHudSurface, detail?: string | null): string | null {
  const where = SURFACE_LABEL[surface];
  const extra = detail ? ` · ${detail}` : "";
  if (style === "battle-network") return `PET ▸ ${where}${extra} · link ok`;
  if (style === "tactical") return `SYS // ${where}${extra} · nominal`;
  return null;
}

export function NetHudFrame({ surface, detail, className = "" }: { surface: NetHudSurface; detail?: string | null; className?: string }) {
  const { hud, reducedMotion } = useExperienceExtras();
  const label = netHudLabel(hud, surface, detail);
  if (!label) return null;
  return (
    <div
      aria-hidden
      data-net-hud-frame={hud}
      data-reduced-motion={reducedMotion ? "" : undefined}
      className={`pointer-events-none absolute inset-0 z-[5] ${className}`}
    >
      <span data-net-hud-corner="tl" />
      <span data-net-hud-corner="tr" />
      <span data-net-hud-corner="bl" />
      <span data-net-hud-corner="br" />
      <span data-net-hud-label>{label}</span>
    </div>
  );
}
