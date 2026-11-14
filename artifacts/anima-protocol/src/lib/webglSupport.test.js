import { describe, expect, it } from "vitest";
import { hasWebGL, probeWebGL, resetWebGLProbe } from "./webglSupport";

describe("hasWebGL", () => {
  it("returns a boolean without throwing", () => {
    resetWebGLProbe();
    expect(typeof hasWebGL()).toBe("boolean");
  });

  it("probe never passes context attributes (no failIfMajorPerformanceCaveat)", () => {
    const calls = [];
    probeWebGL(() => ({ getContext: (...args) => (calls.push(args), null) }));
    expect(calls.every((a) => a.length === 1)).toBe(true);
    expect(calls.map((a) => a[0])).toEqual(["webgl2", "webgl", "experimental-webgl"]);
  });
});
