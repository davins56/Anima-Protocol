/**
 * Resonance-node taps use an explicit Raycaster restricted to a dedicated
 * THREE.Layers channel, so panels, vessels and FX in front of a node never
 * steal the tap (and the per-tap cost is a handful of node meshes, not the
 * whole scene). Panels themselves use R3F pointer events on layer 0.
 */
import * as THREE from "three";

export const RESONANCE_RAY_LAYER = 5;

export type ResonanceHit = { layer: number; point: THREE.Vector3 };

/** Mark an object (and its meshes) as a tappable resonance node for arena layer `layer`. */
export function markResonanceNode(obj: THREE.Object3D, layer: number): void {
  obj.userData.resonanceLayer = layer;
  obj.traverse((o) => o.layers.enable(RESONANCE_RAY_LAYER));
}

export function pickResonanceNode(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  ndc: { x: number; y: number },
  root: THREE.Object3D,
): ResonanceHit | null {
  raycaster.layers.set(RESONANCE_RAY_LAYER);
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  for (const hit of raycaster.intersectObject(root, true)) {
    let o: THREE.Object3D | null = hit.object;
    while (o && typeof o.userData.resonanceLayer !== "number") o = o.parent;
    if (o) return { layer: o.userData.resonanceLayer as number, point: hit.point };
  }
  return null;
}

/** Client pixel → normalised device coordinates for an element. */
export function toNdc(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  return { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1 };
}
