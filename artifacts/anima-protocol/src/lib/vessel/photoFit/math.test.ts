import { describe, expect, it } from "vitest";
import { jacobiEigen, mulMat3, similarityAlign, type Vec3 } from "./math";

describe("photoFit math", () => {
  it("jacobiEigen diagonalises a symmetric matrix", () => {
    const { values } = jacobiEigen([2, 1, 0, 1, 2, 0, 0, 0, 5], 3);
    expect([...values].sort((a, b) => a - b).map((v) => +v.toFixed(6))).toEqual([1, 3, 5]);
  });

  it("similarityAlign recovers scale, rotation and translation", () => {
    const a = 0.4;
    const R = [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)] as const;
    const src: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 2, 0], [0, 0, 3], [1, 1, 1], [-2, 0.5, 1]];
    const dst = src.map((p) => {
      const r = mulMat3([...R] as never, p);
      return [r[0] * 2.5 + 10, r[1] * 2.5 - 3, r[2] * 2.5 + 1] as Vec3;
    });
    const fit = similarityAlign(src, dst);
    expect(fit.s).toBeCloseTo(2.5, 6);
    fit.R.forEach((v, i) => expect(v).toBeCloseTo(R[i], 6));
    expect(fit.t[0]).toBeCloseTo(10, 6);
    expect(fit.t[1]).toBeCloseTo(-3, 6);
    expect(fit.t[2]).toBeCloseTo(1, 6);
  });
});
