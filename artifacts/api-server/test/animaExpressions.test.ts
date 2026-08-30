import { describe, it, expect } from "vitest";
import {
  formatExpressionPrompt,
  normalizeExpressionSpectrum,
} from "../src/lib/animaExpressions";

describe("formatExpressionPrompt", () => {
  it("describes a blend so the companion can live between poles", () => {
    const prompt = formatExpressionPrompt({
      angelic: 45,
      ascended: 40,
      neutral: 15,
      descended: 0,
      demonic: 0,
    });
    expect(prompt).toMatch(/live between multiple expressions/i);
    expect(prompt).toMatch(/Angelic/i);
    expect(prompt).toMatch(/Ascended/i);
  });

  it("defaults missing spectrum to Neutral", () => {
    const prompt = formatExpressionPrompt(null);
    expect(prompt).toMatch(/Neutral/i);
  });
});

describe("normalizeExpressionSpectrum", () => {
  it("fills all five poles", () => {
    const out = normalizeExpressionSpectrum({ demonic: 50 });
    expect(out.demonic).toBe(50);
    expect(out.neutral).toBe(0);
    expect(out.angelic).toBe(0);
  });
});
