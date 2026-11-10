/** Parses real (tiny, generated) GLB / VRM 1.0 / VRM 0.x bytes through @pixiv/three-vrm. */
import { describe, expect, it } from "vitest";
import { disposeVesselAsset, parseVesselAsset } from "./vrmRuntime";

const BONES = [
  "hips", "spine", "chest", "neck", "head",
  "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot",
];

function glbFrom(json: object): ArrayBuffer {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (enc.length % 4)) % 4;
  const jsonLen = enc.length + pad;
  const total = 12 + 8 + jsonLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(enc, 20);
  for (let i = 0; i < pad; i++) out[20 + enc.length + i] = 0x20;
  return out.buffer;
}

function skeleton() {
  // flat hierarchy under a root, one node per bone
  const nodes = [{ name: "root", children: BONES.map((_, i) => i + 1) }, ...BONES.map((b, i) => ({ name: b, translation: [0, 0.1 * i, 0] }))];
  return { nodes, bone: (b: string) => BONES.indexOf(b) + 1 };
}

function vrm1() {
  const { nodes, bone } = skeleton();
  return glbFrom({
    asset: { version: "2.0" },
    extensionsUsed: ["VRMC_vrm"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        meta: { name: "Test", authors: ["t"], licenseUrl: "https://vrm.dev/licenses/1.0/" },
        humanoid: { humanBones: Object.fromEntries(BONES.map((b) => [b, { node: bone(b) }])) },
        expressions: { preset: { happy: {}, blink: {}, aa: {}, sad: {} } },
      },
    },
  });
}

function vrm0() {
  const { nodes, bone } = skeleton();
  return glbFrom({
    asset: { version: "2.0" },
    extensionsUsed: ["VRM"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    extensions: {
      VRM: {
        specVersion: "0.0",
        meta: { title: "Old" },
        humanoid: { humanBones: BONES.map((b) => ({ bone: b, node: bone(b) })) },
        blendShapeMaster: {
          blendShapeGroups: [
            { name: "Joy", presetName: "joy", binds: [] },
            { name: "A", presetName: "a", binds: [] },
            { name: "Blink", presetName: "blink", binds: [] },
          ],
        },
      },
    },
  });
}

describe("parseVesselAsset", () => {
  it("loads a VRM 1.0 with humanoid + expressions", async () => {
    const a = await parseVesselAsset(vrm1());
    expect(a.vrm).not.toBeNull();
    expect(a.vrm!.humanoid.getNormalizedBoneNode("leftUpperArm")).toBeTruthy();
    expect(a.expressionNames).toEqual(expect.arrayContaining(["happy", "blink", "aa", "sad"]));
    a.vrm!.expressionManager!.setValue("happy", 0.7);
    a.vrm!.update(1 / 60);
    expect(a.vrm!.expressionManager!.getValue("happy")).toBeCloseTo(0.7);
    expect(a.vrm!.scene.rotation.y).toBe(0);
    disposeVesselAsset(a);
  });
  it("loads a VRM 0.x, exposes VRM 1.0 preset names, and rotates it to face the camera", async () => {
    const a = await parseVesselAsset(vrm0());
    expect(a.vrm).not.toBeNull();
    expect(a.expressionNames).toEqual(expect.arrayContaining(["happy", "aa", "blink"]));
    expect(Math.abs(a.vrm!.scene.rotation.y)).toBeCloseTo(Math.PI);
    disposeVesselAsset(a);
  });
  it("loads a plain GLB as a static scene", async () => {
    const a = await parseVesselAsset(glbFrom({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "body" }] }));
    expect(a.vrm).toBeNull();
    expect(a.scene.getObjectByName("body")).toBeTruthy();
    expect(a.expressionNames).toEqual([]);
    disposeVesselAsset(a);
  });
  it("rejects garbage", async () => {
    await expect(parseVesselAsset(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toBeTruthy();
  });
});
