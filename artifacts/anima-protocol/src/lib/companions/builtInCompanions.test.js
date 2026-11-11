import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_COMPANIONS,
  builtInCompanionFor,
  builtInCompanionRecord,
  builtInIdentityLock,
  ensureBuiltInCompanion,
} from "./builtInCompanions";
import {
  AELAND_NAME,
  PERSONAL_ANIMA_NAME_ALIASES,
  canonicalCompanionName,
  canonicalizeCompanionRow,
  isAelandName,
  isKnownPersonalAnimaName,
} from "@/lib/personalAnimaRecord";
import { companionPersistPatch } from "@/lib/listPersonalAnimas";
import { buildCharacterPrompt } from "@/lib/buildCharacterPrompt";
import { defaultVesselFor, parseVesselConfig, VESSEL_PRESETS } from "@/lib/vessel/vesselConfig";

describe("Aeland canonical name + legacy aliases", () => {
  it("keeps every legacy spelling and adds aeland", () => {
    for (const a of ["aeland", "aelynd", "aelyndra", "aelindra"]) expect(PERSONAL_ANIMA_NAME_ALIASES).toContain(a);
    for (const n of ["Aeland", "Aelynd", "AELINDRA", "Aelyndra"]) {
      expect(isAelandName(n)).toBe(true);
      expect(isKnownPersonalAnimaName(n)).toBe(true);
      expect(canonicalCompanionName(n)).toBe(AELAND_NAME);
    }
    expect(canonicalCompanionName("Serenity")).toBe("Serenity");
  });
  it("canonicalizes for display but restores the stored spelling on save", () => {
    const row = canonicalizeCompanionRow({ id: "a1", name: "Aelynd" });
    expect(row).toMatchObject({ id: "a1", name: "Aeland", legacy_name: "Aelynd" });
    expect(companionPersistPatch(row).name).toBe("Aelynd");
    expect(companionPersistPatch({ ...row, name: "Aeland Prime" }).name).toBe("Aeland Prime");
    expect(companionPersistPatch(row).legacy_name).toBeUndefined();
  });
  it("legacy vessel base still parses as aeland", () => {
    expect(parseVesselConfig({ base: "aelindra" }).base).toBe("aeland");
    expect(defaultVesselFor({ name: "Aelynd" }).base).toBe("aeland");
    expect(defaultVesselFor({ name: "Aeland" }).base).toBe("aeland");
  });
});

describe("Scarlet built-in companion", () => {
  it("is exact-match only (no franchise collisions) and not a personal-anima alias", () => {
    expect(builtInCompanionFor("Scarlet")?.key).toBe("scarlet");
    expect(builtInCompanionFor("Scarlet Witch")).toBeNull();
    expect(PERSONAL_ANIMA_NAME_ALIASES).not.toContain("scarlet");
  });
  it("template follows Anima conventions with TODO personality and minimal fire traits", () => {
    const rec = builtInCompanionRecord("scarlet");
    expect(rec).toMatchObject({ name: "Scarlet", _isAnima: true, category: "anima-construct", vessel_preset: "scarlet" });
    expect(rec.personality).toMatch(/TODO/);
    expect(rec.backstory).toMatch(/TODO/);
    expect(rec.fire_traits.length).toBeLessThanOrEqual(6);
    expect(BUILT_IN_COMPANIONS.serenity.template).toBeNull();
  });
  it("identity lock keeps her distinct from Serenity", () => {
    expect(builtInIdentityLock({ name: "Scarlet" })).toMatch(/NOT Serenity/);
    expect(builtInIdentityLock({ name: "Lantern Echo" })).toBe("");
    const prompt = buildCharacterPrompt({ character: { name: "Scarlet", personality: "warm" } });
    expect(prompt).toMatch(/BUILT-IN IDENTITY LOCK \(Scarlet\)/);
  });
  it("flame vessel preset", () => {
    const v = parseVesselConfig(VESSEL_PRESETS.scarlet);
    expect(v.base).toBe("scarlet");
    expect(v.effects.aura).toBe("flame");
    expect(defaultVesselFor({ name: "Scarlet" }).effects.aura).toBe("flame");
  });
  it("ensureBuiltInCompanion reuses an existing Scarlet or creates from template", async () => {
    const create = vi.fn(async (entity, rec) => ({ id: "s1", ...rec, entity }));
    expect(await ensureBuiltInCompanion("scarlet", [{ id: "x", name: "scarlet" }], create)).toMatchObject({ id: "x" });
    expect(create).not.toHaveBeenCalled();
    const made = await ensureBuiltInCompanion("scarlet", [{ id: "y", name: "Scarlet Witch" }], create);
    expect(made).toMatchObject({ id: "s1", name: "Scarlet", entity: "Anima" });
  });
});
