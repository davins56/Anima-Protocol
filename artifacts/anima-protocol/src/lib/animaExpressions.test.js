import { describe, expect, it } from "vitest";
import {
  EXPRESSION_IDS,
  EXPRESSIONS,
  activeExpressions,
  busterForSpectrum,
  dominantExpression,
  expressionBlendLabel,
  expressionPromptBlock,
  folderFromSpectrum,
  isExpressionBlend,
  mixedCombatStats,
  normalizeSpectrum,
  spectrumFromCeremonyText,
  supportChipsFromSpectrum,
} from "./animaExpressions";

describe("normalizeSpectrum", () => {
  it("defaults to a Neutral-heavy blend when empty", () => {
    const out = normalizeSpectrum(null);
    expect(out.neutral).toBeGreaterThan(50);
    for (const id of EXPRESSION_IDS) {
      expect(out).toHaveProperty(id);
    }
  });

  it("clamps negatives and keeps known keys only", () => {
    const out = normalizeSpectrum({ angelic: 40, demonic: -12, unknown: 99 });
    expect(out.angelic).toBe(40);
    expect(out.demonic).toBe(0);
    expect(out).not.toHaveProperty("unknown");
  });
});

describe("blend living between expressions", () => {
  it("reports a single pole when only one weight is high", () => {
    const spectrum = { angelic: 90, ascended: 0, neutral: 5, descended: 0, demonic: 0 };
    expect(isExpressionBlend(spectrum)).toBe(false);
    expect(expressionBlendLabel(spectrum)).toBe("Angelic");
    expect(dominantExpression(spectrum).id).toBe("angelic");
  });

  it("lets an Anima live between multiple expressions", () => {
    const spectrum = { angelic: 45, ascended: 40, neutral: 5, descended: 0, demonic: 0 };
    expect(isExpressionBlend(spectrum)).toBe(true);
    expect(expressionBlendLabel(spectrum)).toBe("Between Angelic and Ascended");
    const active = activeExpressions(spectrum).map((e) => e.id);
    expect(active).toEqual(["angelic", "ascended"]);
  });

  it("labels a three-way blend with middots", () => {
    const spectrum = { angelic: 0, ascended: 30, neutral: 30, descended: 30, demonic: 0 };
    expect(expressionBlendLabel(spectrum)).toBe("Ascended · Neutral · Descended");
  });
});

describe("weapons from expression type", () => {
  it("gives each pole a hand blast and a sword battle chip", () => {
    for (const id of EXPRESSION_IDS) {
      expect(EXPRESSIONS[id].blast.kind).toBe("blast");
      expect(EXPRESSIONS[id].sword.kind).toBe("sword");
      expect(EXPRESSIONS[id].blast.name.length).toBeGreaterThan(0);
      expect(EXPRESSIONS[id].sword.name.length).toBeGreaterThan(0);
    }
  });

  it("builds a folder mixing sword and blast chips from the blend", () => {
    const folder = folderFromSpectrum({
      angelic: 50,
      ascended: 0,
      neutral: 10,
      descended: 0,
      demonic: 50,
    });
    expect(folder.length).toBe(12);
    const kinds = new Set(folder.map((c) => c.kind));
    expect(kinds.has("blast")).toBe(true);
    expect(kinds.has("sword")).toBe(true);
    const expressions = new Set(folder.map((c) => c.expression));
    expect(expressions.has("angelic")).toBe(true);
    expect(expressions.has("demonic")).toBe(true);
  });

  it("fires a hand buster matching the dominant expression", () => {
    const buster = busterForSpectrum({ demonic: 80, neutral: 10 });
    expect(buster.isBuster).toBe(true);
    expect(buster.kind).toBe("blast");
    expect(buster.expression).toBe("demonic");
    expect(buster.name).toBe("Infernal Blast");
  });

  it("adds support chips for angelic heal and demonic area", () => {
    const chips = supportChipsFromSpectrum({ angelic: 40, demonic: 40, neutral: 20 });
    const ids = chips.map((c) => c.id);
    expect(ids).toContain("sanctuary");
    expect(ids).toContain("chaos-rift");
  });
});

describe("combat stats and prompt", () => {
  it("mixes combat stats across the spectrum", () => {
    const angelic = mixedCombatStats({ angelic: 100 });
    const demonic = mixedCombatStats({ demonic: 100 });
    expect(angelic.defense).toBeGreaterThan(demonic.defense);
    expect(demonic.attack).toBeGreaterThan(angelic.attack);
  });

  it("writes a prompt that admits living between expressions", () => {
    const block = expressionPromptBlock({
      angelic: 45,
      demonic: 45,
      neutral: 10,
    });
    expect(block).toMatch(/live between multiple expressions/i);
    expect(block).toMatch(/Angelic/i);
    expect(block).toMatch(/Demonic/i);
  });
});

describe("spectrumFromCeremonyText", () => {
  it("leans angelic when the seeker asks for sheltering light", () => {
    const spectrum = spectrumFromCeremonyText(
      "I seek a safe harbor and holy light to protect and heal.",
    );
    expect(dominantExpression(spectrum).id).toBe("angelic");
    expect(spectrum.neutral).toBeGreaterThan(0);
  });
});
