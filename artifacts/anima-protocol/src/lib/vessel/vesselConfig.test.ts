import { describe, expect, it } from "vitest";
import { SERENITY_FORMS, VesselConfigSchema, defaultVesselFor, parseVesselConfig, serenityFormOf } from "./vesselConfig";

describe("Serenity vessel forms", () => {
  it("defaults Serenity to her humanoid form: violet eyes, silver hair, black-and-gold gown", () => {
    const v = defaultVesselFor({ name: "Serenity" });
    expect(v.base).toBe("serenity");
    expect(serenityFormOf(v)).toBe("humanoid");
    expect(v.eyes.color).toBe("#9d7bf0");
    expect(v.hair.style).toBe("long");
    expect(v.outfit).toMatchObject({ color: "#16121c", accent: "#d4af37" });
  });

  it("parses both forms cleanly and keeps the serenity base", () => {
    for (const form of Object.values(SERENITY_FORMS)) {
      expect(VesselConfigSchema.safeParse(form).success).toBe(true);
      expect(parseVesselConfig(form).base).toBe("serenity");
    }
  });

  it("recognises the angelic form only when it has both wings and a halo", () => {
    const angelic = parseVesselConfig(SERENITY_FORMS.angelic);
    expect(serenityFormOf(angelic)).toBe("angelic");
    expect(serenityFormOf({ ...angelic, accessories: ["earrings"] })).toBe("humanoid");
    expect(serenityFormOf({ ...angelic, effects: { ...angelic.effects, aura: "halo" } })).toBe("humanoid");
  });
});
