/**
 * Plain-GLB faces with ARKit-named morph targets (eyeBlinkLeft, jawOpen,
 * mouthSmileLeft, …: the photo-to-vessel head, or any ARKit-rigged GLB).
 * Pure weight maths + a scene scanner; the per-frame hook lives in
 * components/vessel/useArkitFace.
 */
import type { Object3D, Mesh } from "three";
import type { Expression } from "./emotion";

export const ARKIT_FACE_DRIVEN = ["eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthSmileLeft", "mouthSmileRight"] as const;
export type ArkitFaceName = (typeof ARKIT_FACE_DRIVEN)[number];
export type ArkitFaceWeights = Partial<Record<ArkitFaceName, number>>;

const c01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/**
 * blink: 0..1 from the blinker; openness: 0..1 speech openness;
 * expression: the procedural Expression (eyeOpen < ~0.85 droops the lids, smile > 0 smiles).
 */
export function arkitFaceWeights(input: { blink: number; openness: number; expression?: Expression | null }): Record<ArkitFaceName, number> {
  const e = input.expression;
  const droop = e ? c01((0.85 - e.eyeOpen) / 0.85) * 0.6 : 0;
  const lids = c01(Math.max(droop, input.blink));
  const smile = e ? c01(e.smile) * 0.75 : 0;
  return {
    eyeBlinkLeft: lids,
    eyeBlinkRight: lids,
    jawOpen: c01(input.openness) * 0.7,
    mouthSmileLeft: smile,
    mouthSmileRight: smile,
  };
}

export type ArkitMeshBinding = { mesh: Mesh; index: Partial<Record<ArkitFaceName, number>> };

/** Meshes in `scene` exposing at least one ARKit face morph. */
export function findArkitMeshes(scene: Object3D): ArkitMeshBinding[] {
  const out: ArkitMeshBinding[] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    const dict = mesh.morphTargetDictionary;
    if (!mesh.isMesh || !dict || !mesh.morphTargetInfluences) return;
    const index: ArkitMeshBinding["index"] = {};
    for (const name of ARKIT_FACE_DRIVEN) if (dict[name] !== undefined) index[name] = dict[name];
    if (Object.keys(index).length) out.push({ mesh, index });
  });
  return out;
}

export function applyArkitWeights(bindings: ArkitMeshBinding[], weights: ArkitFaceWeights) {
  for (const { mesh, index } of bindings) {
    const inf = mesh.morphTargetInfluences!;
    for (const [name, i] of Object.entries(index) as [ArkitFaceName, number][]) {
      const w = weights[name];
      if (w !== undefined) inf[i] = c01(w);
    }
  }
}
