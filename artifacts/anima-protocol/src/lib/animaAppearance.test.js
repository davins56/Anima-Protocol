import { describe, expect, it } from "vitest";
import {
  APPEARANCE_FEATURES,
  buildAppearanceImagePrompt,
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

describe("buildAppearanceImagePrompt", () => {
  it("includes name, archetype, and set features", () => {
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
    expect(prompt).toContain("Skin colour / complexion: deep ebony");
    expect(prompt).toContain("Hair: long silver wavy");
    expect(prompt).toContain("Eyes: glowing violet");
    expect(prompt).toContain("Art style: anime illustration");
    expect(prompt).toContain("character-focused portrait");
  });

  it("applies defaults when style/setting/mood are empty", () => {
    const prompt = buildAppearanceImagePrompt({ name: "Nova" }, {});
    expect(prompt).toContain("digital art illustration");
    expect(prompt).toContain("ethereal atmospheric background");
    expect(prompt).toContain("confident and captivating expression");
  });
});
