import { describe, expect, it } from "vitest";
import { RESONANCE_SPECTRUM, resonanceBandAt, spectrumColorAt } from "./anima-tokens";

describe("anima resonance tokens", () => {
  it("covers 0–100 contiguously", () => {
    expect(RESONANCE_SPECTRUM[0].min).toBe(0);
    expect(RESONANCE_SPECTRUM[RESONANCE_SPECTRUM.length - 1].max).toBe(100);
    for (let i = 1; i < RESONANCE_SPECTRUM.length; i++) expect(RESONANCE_SPECTRUM[i].min).toBe(RESONANCE_SPECTRUM[i - 1].max);
  });
  it("maps bands per spec", () => {
    expect(resonanceBandAt(5).key).toBe("noise");
    expect(resonanceBandAt(20).key).toBe("ambient");
    expect(resonanceBandAt(60).key).toBe("data");
    expect(resonanceBandAt(80).key).toBe("rare");
    expect(resonanceBandAt(96.3).key).toBe("serenity");
    expect(resonanceBandAt(100).key).toBe("serenity");
  });
  it("crossfades continuously (pure colour at band centres, blend between)", () => {
    expect(spectrumColorAt(10).toLowerCase()).toBe("#b91c1c");
    expect(spectrumColorAt(94).toLowerCase()).toBe("#8b5cf6");
    const mid = spectrumColorAt(87.75);
    expect(mid).not.toBe(spectrumColorAt(81.5));
    expect(mid).not.toBe(spectrumColorAt(94));
    expect(spectrumColorAt(-5)).toBe(spectrumColorAt(0));
  });
});
