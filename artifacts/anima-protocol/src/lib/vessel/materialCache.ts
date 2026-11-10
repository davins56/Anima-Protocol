/** Shared procedural-vessel materials, keyed by colour + mode, ref-counted and disposed when unused. */
import { useLayoutEffect } from "react";
import * as THREE from "three";
import { createRefCache } from "./refCache";

export type VesselMatSpec = { color: string; hologram: boolean; emissive?: string; emissiveIntensity?: number };

export function materialKey({ color, hologram, emissive, emissiveIntensity = 0 }: VesselMatSpec): string {
  return hologram ? `holo|${color}` : `std|${color}|${emissive ?? ""}|${emissive ? emissiveIntensity : 0}`;
}

export function createVesselMaterial({ color, hologram, emissive, emissiveIntensity = 0 }: VesselMatSpec): THREE.Material {
  if (hologram) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  }
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.7,
    metalness: 0.05,
    emissive: emissive ? new THREE.Color(emissive) : new THREE.Color(0),
    emissiveIntensity,
  });
}

export const vesselMaterials = createRefCache<THREE.Material>((m) => m.dispose());

/** A cached material held for as long as the calling component uses this key. */
export function useVesselMaterial(spec: VesselMatSpec): THREE.Material {
  const key = materialKey(spec);
  const mat = vesselMaterials.get(key, () => createVesselMaterial(spec));
  useLayoutEffect(() => {
    vesselMaterials.retain(key);
    return () => vesselMaterials.release(key);
  }, [key]);
  return mat;
}
