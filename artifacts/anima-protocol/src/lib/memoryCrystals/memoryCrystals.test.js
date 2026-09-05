import { describe, it, expect } from "vitest";
import { isEchoLibrarySteward } from "../echoKeys/steward.js";
import {
  MEMORY_CRYSTAL_TYPES,
  MEMORY_CRYSTAL_TYPE_IDS,
  MILESTONE_CONFIG,
  defaultMemoryCrystalTypes,
  normalizeMemoryCrystalTypes,
  storedCrystalTypesAreFull,
} from "./index.js";

describe("memory crystal milestone types", () => {
  it("lists the discrete attainable types without inventing conversation crystals", () => {
    expect(MEMORY_CRYSTAL_TYPE_IDS).toHaveLength(7);
    expect(MEMORY_CRYSTAL_TYPES.map((t) => t.id)).toEqual(MEMORY_CRYSTAL_TYPE_IDS);
    expect(MILESTONE_CONFIG.first_contact.label).toBe("First Contact");
    expect(MILESTONE_CONFIG.shadow_confrontation.label).toBe("Shadow Work");
  });

  it("leaves types locked for everyone except the steward grant", () => {
    expect(isEchoLibrarySteward({ email: "seeker@example.com" })).toBe(false);
    const starter = defaultMemoryCrystalTypes();
    expect(starter.granted_all_types).toBe(false);
    expect(starter.unlocked_types).toEqual([]);
    const stale = normalizeMemoryCrystalTypes({ granted_all_types: false, unlocked_types: [] });
    expect(stale.granted_all_types).toBe(false);
    expect(stale.unlocked_types).toEqual([]);
  });

  it("unlocks every milestone type only for the steward", () => {
    expect(isEchoLibrarySteward({ email: "davins56@gmail.com" })).toBe(true);
    expect(isEchoLibrarySteward({ username: "davins56" })).toBe(true);
    expect(isEchoLibrarySteward({ role: "admin" })).toBe(false);

    const steward = defaultMemoryCrystalTypes({}, { grantAllTypes: true });
    expect(steward.granted_all_types).toBe(true);
    expect(steward.unlocked_types).toEqual(MEMORY_CRYSTAL_TYPE_IDS);
    const upgraded = normalizeMemoryCrystalTypes(
      { granted_all_types: false, unlocked_types: ["first_contact"] },
      { grantAllTypes: true },
    );
    expect(upgraded.unlocked_types).toEqual(MEMORY_CRYSTAL_TYPE_IDS);
    expect(
      storedCrystalTypesAreFull(
        { granted_all_types: true, unlocked_types: MEMORY_CRYSTAL_TYPE_IDS },
        MEMORY_CRYSTAL_TYPE_IDS.length,
      ),
    ).toBe(true);
    expect(
      storedCrystalTypesAreFull({ granted_all_types: false, unlocked_types: [] }, MEMORY_CRYSTAL_TYPE_IDS.length),
    ).toBe(false);
  });
});
