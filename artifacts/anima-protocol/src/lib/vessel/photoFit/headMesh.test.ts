import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CANONICAL_VERTICES } from "./faceTopology.data";
import { fitPhotoHead } from "./headFit";
import { exportGlb, percentileColor, photoHeadGeometry, photoHeadVertexColors } from "./headMesh";

function lm() {
  const out = [];
  for (let i = 0; i < 478; i++) {
    const j = Math.min(i, 467);
    out.push({ x: 0.5 + CANONICAL_VERTICES[j * 3] * 0.025, y: 0.5 - CANONICAL_VERTICES[j * 3 + 1] * 0.025, z: -CANONICAL_VERTICES[j * 3 + 2] * 0.025 });
  }
  return out;
}

describe("photo head mesh", () => {
  const head = fitPhotoHead(lm(), 1000, 1000);

  it("builds a grouped geometry with relative ARKit morphs and white face colours", () => {
    const colors = photoHeadVertexColors(head, () => new THREE.Color(1, 0, 0), { hair: "#00ff00", skin: "#0000ff" });
    const g = photoHeadGeometry(head, colors);
    expect(g.groups).toHaveLength(3);
    expect(g.morphTargetsRelative).toBe(true);
    expect(g.morphAttributes.position.map((a) => a.name)).toEqual(["eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthSmileLeft", "mouthSmileRight"]);
    expect([colors[0], colors[1], colors[2]]).toEqual([1, 1, 1]); // face vertex untouched
    const ring0 = head.skull.find((s) => s.progress === 0)!;
    expect(colors[ring0.index * 3]).toBeCloseTo(1); // seam starts at the photo edge colour
  });

  it("round-trips through GLB with morph target names", async () => {
    const mesh = new THREE.Mesh(photoHeadGeometry(head), [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
    mesh.updateMorphTargets();
    const bytes = await exportGlb(new THREE.Group().add(mesh));
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    const gltf = await new GLTFLoader().parseAsync(bytes, "");
    const names = new Set<string>();
    gltf.scene.traverse((o) => Object.keys((o as THREE.Mesh).morphTargetDictionary ?? {}).forEach((n) => names.add(n)));
    expect([...names].sort()).toEqual(["eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthSmileLeft", "mouthSmileRight"]);
  });

  it("percentileColor picks by luminance", () => {
    const d = new Uint8Array([0, 0, 0, 255, 100, 100, 100, 255, 250, 250, 250, 255, 9, 9, 9, 0]);
    expect(percentileColor(d, 0.5)).toBe("#646464");
    expect(percentileColor(d, 1)).toBe("#fafafa");
  });
});
