import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyArkitWeights, arkitFaceWeights, findArkitMeshes } from "./arkitFace";
import { expressionFor } from "./emotion";

describe("arkitFace", () => {
  it("maps blink, speech and smile to ARKit weights", () => {
    const w = arkitFaceWeights({ blink: 1, openness: 1, expression: expressionFor("happy", 100) });
    expect(w.eyeBlinkLeft).toBe(1);
    expect(w.jawOpen).toBeCloseTo(0.7);
    expect(w.mouthSmileLeft).toBeGreaterThan(0.5);
    const sad = arkitFaceWeights({ blink: 0, openness: 0, expression: expressionFor("sad", 100) });
    expect(sad.mouthSmileLeft).toBe(0);
    expect(sad.eyeBlinkLeft).toBeGreaterThan(0.1); // droopy lids
    expect(arkitFaceWeights({ blink: NaN, openness: 5 }).jawOpen).toBeCloseTo(0.7);
  });

  it("rounds the lips for ou/oh visemes and maps brow / frown", () => {
    const o = arkitFaceWeights({ blink: 0, openness: 1, round: 1 });
    expect(o.mouthFunnel).toBeCloseTo(0.7);
    expect(o.mouthPucker).toBeGreaterThan(0);
    expect(o.jawOpen).toBeLessThan(0.7);
    expect(arkitFaceWeights({ blink: 0, openness: 0, round: 1 }).mouthFunnel).toBe(0);
    const hostile = arkitFaceWeights({ blink: 0, openness: 0, expression: expressionFor("hostile", 100) });
    expect(hostile.browDownLeft).toBeGreaterThan(0.3);
    expect(hostile.mouthFrownLeft).toBeGreaterThan(0.2);
    expect(hostile.browInnerUp).toBe(0);
  });

  it("finds ARKit-morphed meshes and writes influences", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    g.morphAttributes.position = ["eyeBlinkLeft", "jawOpen", "other"].map((n) => Object.assign(new THREE.BufferAttribute(new Float32Array(9), 3), { name: n }));
    const mesh = new THREE.Mesh(g);
    mesh.updateMorphTargets();
    const plain = new THREE.Mesh(new THREE.BoxGeometry());
    const root = new THREE.Group().add(mesh, plain);
    const b = findArkitMeshes(root);
    expect(b).toHaveLength(1);
    applyArkitWeights(b, { eyeBlinkLeft: 0.5, jawOpen: 2, mouthSmileLeft: 1 });
    expect(mesh.morphTargetInfluences).toEqual([0.5, 1, 0]);
  });
});
