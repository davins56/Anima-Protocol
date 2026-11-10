/**
 * three.js side of uploaded vessels: parse GLB/VRM bytes with
 * @pixiv/three-vrm, optimise, and dispose. Kept separate from the fetch layer
 * so tests can exercise fetch/expiry without WebGL.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

export type ParsedVesselAsset = {
  scene: THREE.Group;
  vrm: VRM | null;
  animations: THREE.AnimationClip[];
  /** Runtime expression names the model exposes (VRM 1.0 names for VRM 0.x too). */
  expressionNames: string[];
};

export async function parseVesselAsset(bytes: ArrayBuffer): Promise<ParsedVesselAsset> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  // parseAsync may transfer/consume the buffer; give each parse its own copy.
  const gltf: GLTF = await loader.parseAsync(bytes.slice(0), "");
  const vrm = (gltf.userData?.vrm as VRM | undefined) ?? null;
  if (vrm) {
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    // VRM 0.x faces -Z; rotate so it faces the camera like VRM 1.0 / our procedural vessel.
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => {
      // Skinned bounds don't follow bones; avoid popping out at screen edges.
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    });
  }
  const names = vrm?.expressionManager ? vrm.expressionManager.expressions.map((e) => e.expressionName) : [];
  return { scene: (vrm?.scene as THREE.Group) ?? gltf.scene, vrm, animations: gltf.animations ?? [], expressionNames: names };
}

export function disposeVesselAsset(asset: ParsedVesselAsset | null) {
  if (!asset) return;
  VRMUtils.deepDispose(asset.scene);
}
