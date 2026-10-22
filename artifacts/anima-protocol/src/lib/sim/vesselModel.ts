/**
 * Bridge the per-companion VesselConfig (3D vessel branch) to the model shape
 * AnimaVesselMesh / BattleFigures3D.SerenityFigure already render, so the navi
 * in the arena *is* the companion's saved vessel — no second avatar pipeline.
 */
import type { VesselConfig } from "@/lib/vessel/vesselConfig";

export type BattleVesselModel = { color: string; accent: string; gold: string; gltf_url?: string; name?: string };

export function vesselToBattleModel(v: VesselConfig | null | undefined, name?: string): BattleVesselModel {
  if (!v) return { color: "#a78bfa", accent: "#e2e8f0", gold: "#fde68a", name };
  return {
    color: v.effects?.color || v.eyes.color,
    accent: v.outfit.color,
    gold: v.outfit.accent,
    gltf_url: v.model?.kind === "gltf" && v.model.url ? v.model.url : undefined,
    name,
  };
}
