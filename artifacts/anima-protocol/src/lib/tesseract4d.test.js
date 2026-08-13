import { describe, expect, it } from "vitest";
import {
  TESSERACT_EDGE_COUNT,
  TESSERACT_EDGES,
  TESSERACT_LINE_FLOATS,
  TESSERACT_VERTEX_COUNT,
  TESSERACT_VERTS,
  createTesseractLinePositions,
  project4to3,
  rotate4d,
  wPhaseScale,
} from "./tesseract4d";

describe("tesseract4d", () => {
  it("has 16 vertices and 32 edges", () => {
    expect(TESSERACT_VERTS).toHaveLength(TESSERACT_VERTEX_COUNT);
    expect(TESSERACT_EDGES).toHaveLength(TESSERACT_EDGE_COUNT);
    expect(TESSERACT_LINE_FLOATS).toBe(192);
  });

  it("connects vertices that differ in exactly one axis", () => {
    for (const [a, b] of TESSERACT_EDGES) {
      let diffs = 0;
      for (let k = 0; k < 4; k++) {
        if (TESSERACT_VERTS[a][k] !== TESSERACT_VERTS[b][k]) diffs += 1;
      }
      expect(diffs).toBe(1);
    }
  });

  it("rotates in the XW plane without changing y or z when those angles are 0", () => {
    const [x, y, z, w] = rotate4d([0.5, 0.25, -0.25, 0.5], { xw: Math.PI / 2 });
    expect(y).toBeCloseTo(0.25);
    expect(z).toBeCloseTo(-0.25);
    expect(x).toBeCloseTo(-0.5);
    expect(w).toBeCloseTo(0.5);
  });

  it("projects a point closer to the W camera as larger in 3-space", () => {
    const far = project4to3([0.5, 0, 0, -0.5], 2);
    const near = project4to3([0.5, 0, 0, 0.5], 2);
    expect(Math.abs(near[0])).toBeGreaterThan(Math.abs(far[0]));
  });

  it("writes a complete line buffer and pulses scale under 4D rotation", () => {
    const lines = createTesseractLinePositions({ xw: 0.4, yw: 0.2 }, 2.5, 1.5);
    expect(lines).toHaveLength(TESSERACT_LINE_FLOATS);
    expect(lines.some((n) => n !== 0)).toBe(true);
    const rest = wPhaseScale({});
    const spun = wPhaseScale({ xw: 0.9, zw: 0.6 });
    expect(rest).toBeGreaterThan(0);
    expect(spun).toBeGreaterThan(0);
  });
});
