import { describe, expect, it } from "vitest";
import { CANONICAL_VERTICES, FACE_TRIANGLES } from "./faceTopology.data";
import { ARKIT_HEAD_MORPHS, FACE_MESH_VERTICES, fitPhotoHead, type NormalizedLandmark } from "./headFit";
import { FACE_OVAL } from "./faceRegions";

/** Synthetic Face Landmarker output: the canonical face, turned by `yawDeg`, projected into a W×H photo. */
function synthLandmarks(yawDeg = 0, W = 800, H = 1000): NormalizedLandmark[] {
  const a = (yawDeg * Math.PI) / 180;
  const out: NormalizedLandmark[] = [];
  const pxPerCm = 22;
  for (let i = 0; i < FACE_MESH_VERTICES; i++) {
    const x = CANONICAL_VERTICES[i * 3], y = CANONICAL_VERTICES[i * 3 + 1], z = CANONICAL_VERTICES[i * 3 + 2];
    const rx = x * Math.cos(a) + z * Math.sin(a);
    const rz = -x * Math.sin(a) + z * Math.cos(a);
    // pixel space: y down, MediaPipe z: smaller = closer (same scale as x)
    out.push({ x: (W / 2 + rx * pxPerCm) / W, y: (H / 2 - y * pxPerCm) / H, z: (-rz * pxPerCm) / W });
  }
  for (let k = 0; k < 10; k++) out.push({ ...out[k < 5 ? 468 - 1 : 0] }); // iris placeholders (unused by the mesh)
  return out;
}

const vec = (arr: Float32Array, i: number) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

describe("fitPhotoHead", () => {
  const head = fitPhotoHead(synthLandmarks(0), 800, 1000, { skullRings: 9 });

  it("builds face + mouth cavity + cranium with valid indices", () => {
    const n = head.positions.length / 3;
    expect(n).toBe(FACE_MESH_VERTICES + 21 + FACE_OVAL.length * 9 + 1);
    expect(head.uvs.length / 2).toBe(n);
    expect(Math.max(...head.indices)).toBeLessThan(n);
    expect(head.groups.map((g) => g.material)).toEqual(["face", "hair", "mouth"]);
    expect(head.groups.reduce((s, g) => s + g.count, 0)).toBe(head.indices.length);
    // mouth opened: the 18 inner-lip fill triangles are gone
    expect(head.groups[0].count / 3).toBe(FACE_TRIANGLES.length / 3 - 18);
    for (const v of head.uvs) expect(v >= 0 && v <= 1).toBe(true);
  });

  it("is roughly head sized and sits on the vessel neck", () => {
    expect(head.metrics.faceHeightCm).toBeGreaterThan(15);
    expect(head.metrics.faceHeightCm).toBeLessThan(20);
    const ys: number[] = [], zs: number[] = [];
    for (let i = 0; i < head.positions.length; i += 3) {
      ys.push(head.positions[i + 1]);
      zs.push(head.positions[i + 2]);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.18);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.3);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.17);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeGreaterThan(1.45);
    expect(head.metrics.canonicalRmsCm).toBeLessThan(0.05);
  });

  it("exposes ARKit morphs with the expected motion", () => {
    expect(Object.keys(head.morphs)).toEqual([...ARKIT_HEAD_MORPHS]);
    // right upper lid (159) closes downward; left eye untouched by eyeBlinkRight
    expect(vec(head.morphs.eyeBlinkRight, 159)[1]).toBeLessThan(-0.003);
    expect(Math.abs(vec(head.morphs.eyeBlinkRight, 386)[1])).toBe(0);
    expect(vec(head.morphs.eyeBlinkLeft, 386)[1]).toBeLessThan(-0.003);
    // jaw: chin drops, forehead and upper lip stay
    expect(vec(head.morphs.jawOpen, 152)[1]).toBeLessThan(-0.01);
    expect(vec(head.morphs.jawOpen, 14)[1]).toBeLessThan(-0.005);
    expect(Math.abs(vec(head.morphs.jawOpen, 13)[1])).toBe(0);
    expect(Math.abs(vec(head.morphs.jawOpen, 10)[1])).toBe(0);
    // smile: subject's left corner (291) rises and moves outward (+x); right corner barely
    const l = vec(head.morphs.mouthSmileLeft, 291);
    expect(l[1]).toBeGreaterThan(0.003);
    expect(l[0]).toBeGreaterThan(0.002);
    expect(Math.abs(vec(head.morphs.mouthSmileLeft, 61)[1])).toBeLessThan(l[1] * 0.1);
  });

  it("removes head pose: a turned face fits to the same frontal shape", () => {
    const turned = fitPhotoHead(synthLandmarks(25), 800, 1000, { skullRings: 9 });
    expect(turned.metrics.yawDeg).toBeCloseTo(25, 0);
    for (const i of [1, 10, 152, 234, 454]) {
      const a = vec(head.positions, i), b = vec(turned.positions, i);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.002);
    }
  });

  it("rejects too few landmarks", () => {
    expect(() => fitPhotoHead(synthLandmarks().slice(0, 100), 800, 1000)).toThrow(/468/);
  });
});
