import { describe, expect, it } from "vitest";
import { builtInIdentityLock, builtInKeyFor, canonicalCompanionName, isLegacyAelandName } from "../src/lib/companions/builtIn";
import { sanitizeVesselConfig } from "../src/lib/vessel/vesselStore";

describe("companion roster (server)", () => {
  it("canonical Aeland with legacy aliases", () => {
    for (const n of ["Aelynd", "aelyndra", "Aelindra", "Aeland"]) expect(canonicalCompanionName(n)).toBe("Aeland");
    expect(isLegacyAelandName("Aelynd")).toBe(true);
    expect(isLegacyAelandName("Aeland")).toBe(false);
    expect(canonicalCompanionName("Serenity")).toBe("Serenity");
  });
  it("Scarlet is exact-match and locked apart from Serenity", () => {
    expect(builtInKeyFor("Scarlet")).toBe("scarlet");
    expect(builtInKeyFor("Scarlet Witch")).toBeNull();
    expect(builtInIdentityLock("Scarlet")).toMatch(/not Serenity/);
    expect(builtInIdentityLock("Korra")).toBe("");
  });
  it("vessel whitelist accepts aeland/scarlet/flame and maps legacy aelindra", () => {
    expect((sanitizeVesselConfig({ base: "aelindra" }) as any).base).toBe("aeland");
    const c = sanitizeVesselConfig({ base: "scarlet", effects: { aura: "flame" } }) as any;
    expect(c.base).toBe("scarlet");
    expect(c.effects.aura).toBe("flame");
  });
});
