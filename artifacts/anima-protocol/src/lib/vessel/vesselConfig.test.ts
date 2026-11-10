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

describe("VesselConfig schema 2", () => {
  it("upgrades a schema 1 record and keeps a same-origin model url", () => {
    const v = parseVesselConfig({
      schema: 1,
      base: "serenity",
      model: { kind: "vrm", url: "/api/vessel/serenity/model", expressions: ["happy", "aa"], visemes: ["aa"] },
    });
    expect(v.schema).toBe(2);
    expect(v.model.kind).toBe("vrm");
    expect(v.model.url).toBe("/api/vessel/serenity/model");
    expect(v.model.expressions).toEqual(["happy", "aa"]);
    expect(v.model.visemes).toEqual(["aa"]);
  });

  it("rejects an http model url at the schema boundary", () => {
    expect(
      VesselConfigSchema.safeParse({ model: { kind: "vrm", url: "http://cdn.example.com/a.vrm" } }).success,
    ).toBe(false);
  });
});
