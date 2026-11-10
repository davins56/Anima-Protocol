import { describe, expect, it } from "vitest";
import { availableVisemes, speechOpenness, visemeWeights } from "./vrmVisemes";
import { getVisemeOpenness } from "@/lib/livingPresence";

describe("speechOpenness", () => {
  it("is closed when silent and follows getVisemeOpenness while speaking", () => {
    expect(speechOpenness(1234, false)).toBe(0);
    const o = speechOpenness(1234, true);
    expect(o).toBeCloseTo((getVisemeOpenness(1234, true) - 0.08) / 0.92);
    expect(o).toBeGreaterThan(0);
  });
  it("prefers a live audio level when one is provided", () => {
    expect(speechOpenness(0, true, 0.25)).toBeCloseTo(0.4);
    expect(speechOpenness(0, true, 2)).toBe(1);
    expect(speechOpenness(0, false, 1)).toBe(0);
  });
});

describe("visemeWeights", () => {
  it("drives only the model's visemes", () => {
    const av = availableVisemes(["aa", "oh"]);
    for (let t = 0; t < 2000; t += 37) {
      const w = visemeWeights(t, 0.8, av);
      expect(Object.keys(w).every((k) => k === "aa" || k === "oh")).toBe(true);
      const sum = Object.values(w).reduce((a, b) => a + b!, 0);
      expect(sum).toBeCloseTo(0.8);
    }
  });
  it("changes mouth shape over time across aa/ih/ou/ee/oh", () => {
    const seen = new Set<string>();
    for (let t = 0; t < 2000; t += 50) {
      const w = visemeWeights(t, 1, null);
      const top = Object.entries(w).sort((a, b) => b[1]! - a[1]!)[0][0];
      seen.add(top);
    }
    expect([...seen].sort()).toEqual(["aa", "ee", "ih", "oh", "ou"]);
  });
  it("returns nothing when silent or when the model has no visemes", () => {
    expect(visemeWeights(100, 0, null)).toEqual({});
    expect(visemeWeights(100, 1, [])).toEqual({});
    expect(availableVisemes(["AA", "ee", "blink"])).toEqual(["aa", "ee"]);
    expect(availableVisemes(undefined)).toBeNull();
  });
});
