import { describe, expect, it } from "vitest";
import {
  APPEARANCE_FEATURES,
  buildAppearanceImagePrompt,
  expandSkinToneDescriptor,
  normalizeAppearancePrompts,
} from "./animaAppearance";

describe("normalizeAppearancePrompts", () => {
  it("returns empty strings for all features when raw is missing", () => {
    const out = normalizeAppearancePrompts(null);
    for (const f of APPEARANCE_FEATURES) {
      expect(out[f.key]).toBe("");
    }
  });

  it("keeps only known string feature keys", () => {
    const out = normalizeAppearancePrompts({
      skin: "warm medium brown",
      hair: "silver waves",
      outfit: 12,
      unknown: "nope",
    });
    expect(out.skin).toBe("warm medium brown");
    expect(out.hair).toBe("silver waves");
    expect(out.outfit).toBe("");
    expect(out).not.toHaveProperty("unknown");
  });

  it("includes skin among appearance features", () => {
    expect(APPEARANCE_FEATURES.some((f) => f.key === "skin")).toBe(true);
  });
});

describe("expandSkinToneDescriptor", () => {
  it("expands known labels into unambiguous descriptors", () => {
    const deep = expandSkinToneDescriptor("deep ebony");
    expect(deep).toMatch(/deep ebony/i);
    expect(deep).toMatch(/not light/i);
  });

  it("reinforces custom free-text skin tones", () => {
    const custom = expandSkinToneDescriptor("rich copper brown");
    expect(custom).toMatch(/rich copper brown/i);
    expect(custom).toMatch(/face, neck, and hands/i);
  });
});

describe("buildAppearanceImagePrompt", () => {
  it("includes name, archetype, and set features with a skin hard requirement", () => {
    const prompt = buildAppearanceImagePrompt(
      { name: "Serenity", archetype: "guardian", personality: "Calm and wise presence" },
      {
        skin: "deep ebony",
        hair: "long silver wavy",
        eyes: "glowing violet",
        style: "anime illustration",
      },
    );
    expect(prompt).toContain("Serenity");
    expect(prompt).toContain("guardian");
    expect(prompt).toMatch(/^HARD REQUIREMENT — SKIN TONE:/);
    expect(prompt).toMatch(/deep ebony/i);
    expect(prompt).toMatch(/Do not lighten, darken, or ignore/i);
    expect(prompt).toContain("Hair: long silver wavy");
    expect(prompt).toContain("Eyes: glowing violet");
    expect(prompt).toContain("Art style: anime illustration");
    expect(prompt).toMatch(/character-focused/i);
    expect(prompt.indexOf("HARD REQUIREMENT")).toBeLessThan(prompt.indexOf("Hair:"));
  });

  it("applies defaults when style/setting/mood are empty", () => {
    const prompt = buildAppearanceImagePrompt({ name: "Nova" }, {});
    expect(prompt).toContain("digital art illustration");
    expect(prompt).toContain("ethereal atmospheric background");
    expect(prompt).toContain("confident and captivating expression");
  });

  it("frames the prompt for reference-photo editing", () => {
    const prompt = buildAppearanceImagePrompt(
      { name: "Serenity", archetype: "guardian" },
      { hair: "silver waves", skin: "warm medium brown" },
      { useReference: true },
    );
    expect(prompt).toMatch(/Transform the attached reference photo/i);
    expect(prompt).toMatch(/Preserve the person's facial identity/i);
    expect(prompt).toMatch(/resemble the reference person/i);
    expect(prompt).toMatch(/HARD REQUIREMENT — SKIN TONE:/);
  });
});
