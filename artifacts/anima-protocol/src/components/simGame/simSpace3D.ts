/** World-space helpers shared by the sim's 3D components (kept out of component files for fast refresh). */
import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LAYER_W, type Cell } from "@workspace/sim-core";
import { PANEL_THICKNESS, panelWorldPosition } from "@/lib/battleLayout";
import { unitPose, wFrame, wToWorld, type UnitPose } from "@/lib/simClient/wSpace";
import type { FixedStepLoop } from "@/lib/simClient/fixedStepLoop";

/** World position of a (possibly fractional) grid pose on its W plane. */
export function poseWorld(pose: Pick<UnitPose, "col" | "row" | "planeW">, out = new THREE.Vector3()): THREE.Vector3 {
  const [x, y, z] = wToWorld(panelWorldPosition(pose.col, pose.row, PANEL_THICKNESS) as [number, number, number], pose.planeW);
  return out.set(x, y, z);
}

/** Yaw of the arena plane at W (units and the camera turn with it). */
export function planeYaw(planeW: number): number {
  return wFrame(planeW).yaw;
}

/** Arena-local offset → world, for a plane W (camera rig, lattice). */
export function localToWorld(local: [number, number, number], planeW: number, out = new THREE.Vector3()): THREE.Vector3 {
  const [x, y, z] = wToWorld(local, planeW);
  return out.set(x, y, z);
}

export function cellWorld(c: Cell, lift = 0.55, out = new THREE.Vector3()): THREE.Vector3 {
  return poseWorld({ col: c.col, row: c.row, planeW: LAYER_W[c.layer] ?? 0 }, out).setY(out.y + lift);
}

/** Keeps a ref'd object at a unit's interpolated position (FX anchors). */
export function useUnitAnchor(loop: FixedStepLoop, unitId: string) {
  const ref = useRef<THREE.Group>(null);
  const place = () => {
    const pose = unitPose(loop.prev, loop.curr, loop.alpha, unitId);
    if (pose && ref.current) poseWorld(pose, ref.current.position);
  };
  useLayoutEffect(place);
  useFrame(place);
  return ref;
}

/** Set opacity on every material under an object (ref-driven, no React state). */
export function setTreeOpacity(root: THREE.Object3D, opacity: number, color?: THREE.Color): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (!m || Array.isArray(m)) return;
    m.opacity = opacity;
    if (color) m.color.copy(color);
  });
}
