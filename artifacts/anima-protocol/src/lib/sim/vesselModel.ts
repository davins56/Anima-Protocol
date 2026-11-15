/**
 * Bridge the per-companion VesselConfig (3D vessel branch) to the model shape
 * AnimaVesselMesh / BattleFigures3D.SerenityFigure already render, so the navi
 * in the arena *is* the companion's saved vessel — no second avatar pipeline.
 */
import type { VesselConfig } from "@/lib/vessel/vesselConfig";

export type BattleVesselModel = {
  color: string;
  accent: string;
  gold: string;
  /** Plain glTF/GLB body (legacy field AnimaVesselMesh already reads). */
  gltf_url?: string;
  /** Uploaded VRM body, rendered through @pixiv/three-vrm. */
  vrm_url?: string;
  /** Full schema-2 model metadata (expressions, visemes, path for cache keys). */
  vessel_model?: VesselConfig["model"];
  name?: string;
};

export function vesselToBattleModel(v: VesselConfig | null | undefined, name?: string): BattleVesselModel {
  if (!v) return { color: "#a78bfa", accent: "#e2e8f0", gold: "#fde68a", name };
  const m = v.model;
  const hasAsset = Boolean(m?.url) && (m.kind === "gltf" || m.kind === "vrm");
  return {
    color: v.effects?.color || v.eyes.color,
    accent: v.outfit.color,
    gold: v.outfit.accent,
    gltf_url: hasAsset && m.kind === "gltf" ? m.url : undefined,
    vrm_url: hasAsset && m.kind === "vrm" ? m.url : undefined,
    vessel_model: hasAsset ? m : undefined,
    name,
  };
}
