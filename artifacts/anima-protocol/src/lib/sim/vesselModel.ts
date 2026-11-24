/**
 * Bridge the per-companion VesselConfig (3D vessel branch) to the model shape
 * AnimaVesselMesh / BattleFigures3D.SerenityFigure already render, so the navi
 * in the arena *is* the companion's saved vessel — no second avatar pipeline.
 */
import type { VesselConfig } from "@/lib/vessel/vesselConfig";
import { resolveCalibratedLook, type NetForm } from "@/lib/vessel/vesselCalibration";

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
  /**
   * Anima Essence net form (calibration `netForm`, or her non-humanoid vessel
   * type) for Cyberworld / net surfaces; only when user-set. AnimaVesselMesh
   * renders it instead of the navi body.
   */
  net_form?: NetForm;
  /** Net form look: core colour, silver tint, glow 0..1, resonance aura 0..1. */
  net_look?: { core: string; silver: string | null; glow: number | null; aura: number | null };
};

export function vesselToBattleModel(v: VesselConfig | null | undefined, name?: string): BattleVesselModel {
  if (!v) return { color: "#a78bfa", accent: "#e2e8f0", gold: "#fde68a", name };
  const m = v.model;
  const hasAsset = Boolean(m?.url) && (m.kind === "gltf" || m.kind === "vrm");
  const look = resolveCalibratedLook(v);
  const net = look.netForm
    ? { net_form: look.netForm, net_look: { core: look.coreColor, silver: look.silver, glow: look.glow, aura: look.aura } }
    : {};
  return {
    ...net,
    color: v.effects?.color || v.eyes.color,
    accent: v.outfit.color,
    gold: v.outfit.accent,
    gltf_url: hasAsset && m.kind === "gltf" ? m.url : undefined,
    vrm_url: hasAsset && m.kind === "vrm" ? m.url : undefined,
    vessel_model: hasAsset ? m : undefined,
    name,
  };
}
