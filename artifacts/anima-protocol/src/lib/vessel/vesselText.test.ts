import { describe, expect, it } from "vitest";
import { VesselConfigSchema, parseVesselConfig } from "./vesselConfig";
import { applyVesselText } from "./vesselText";

const base = () => parseVesselConfig({});

describe("applyVesselText", () => {
  it("turns a typed description into a schema-valid vessel", () => {
    const r = applyVesselText(
      "short white hair, silver-blue eyes, white robe with an indigo sash, small halo, violet wings, deep brown skin",
      base(),
    );
    expect(r.config.hair).toEqual({ style: "bob", color: "#f5f5f5" });
    expect(r.config.eyes.color).toBe("#b9c6de");
    expect(r.config.outfit).toMatchObject({ top: "robe", color: "#f5f5f5", accent: "#4b3f9e" });
    expect(r.config.effects.aura).toBe("wings");
    expect(r.config.effects.color).toBe("#9670f0");
    expect(r.config.skinTone).not.toBe("#c99a7a");
    expect(VesselConfigSchema.safeParse(r.config).success).toBe(true);
    expect(r.applied.length).toBeGreaterThan(3);
  });

  it("binds each colour to the nearest field in its own clause", () => {
    const r = applyVesselText("black gown with gold accents", base());
    expect(r.config.outfit.bottom).toBe("gown");
    expect(r.config.outfit.color).toBe("#141416");
    expect(r.config.outfit.accent).toBe("#d4af37");
  });

  it("sets enums and accessories the schema already allows", () => {
    const r = applyVesselText("athletic build, a long braid, flame aura, choker and shoulder plates", base());
    expect(r.config.bodyType).toBe("athletic");
    expect(r.config.hair.style).toBe("braid");
    expect(r.config.effects.aura).toBe("flame");
    expect(r.config.accessories).toEqual(expect.arrayContaining(["choker", "shoulder-plates"]));
  });

  it("reports words it cannot place instead of guessing", () => {
    const before = base();
    const r = applyVesselText("make her feel like a thunderstorm of nostalgia", before);
    expect(r.applied).toEqual([]);
    expect(r.config).toEqual(before);
    expect(r.unmatched.length).toBeGreaterThan(0);
  });

  it("never mutates the config it is given", () => {
    const before = base();
    const snapshot = JSON.parse(JSON.stringify(before));
    applyVesselText("violet eyes, white robe, mist aura", before);
    expect(before).toEqual(snapshot);
  });
});
