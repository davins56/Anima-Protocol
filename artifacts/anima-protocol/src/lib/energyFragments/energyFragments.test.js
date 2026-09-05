import { describe, it, expect } from "vitest";
import {
  BATTLE_CHIP_SYSTEM,
  BN1_CHIP_FAMILIES,
  LATER_CHIP_FAMILIES,
  FAMILY_TO_FRAGMENT,
  listedFamilyIds,
  ENERGY_FRAGMENTS,
  FRAGMENT_BY_ID,
  FOLDER_RULES,
  RESONANCE_COMBOS,
  starterFolder,
  validateFolder,
  codesMatch,
  selectionIsLinked,
  findResonance,
  elementMultiplier,
  tacticMultiplier,
  effectivenessVsScan,
  rankHand,
  drawHand,
  makeCopy,
  coveredSourceFamilies,
  energyFragmentLoreBlock,
  cyberspaceBattlePromptBlock,
  starterOwnedIds,
  catalogOwnedIds,
  defaultFragmentLibrary,
  normalizeFragmentLibrary,
  storedFragmentLibraryIsFull,
} from "./index.js";
import { isEchoLibrarySteward } from "../echoKeys/steward.js";
// Import steward directly — the echoKeys barrel loads the 800-key Codex.

describe("battle chip research account", () => {
  it("documents the PET / folder / custom loop", () => {
    expect(BATTLE_CHIP_SYSTEM.title).toMatch(/Battle Chip/i);
    expect(BATTLE_CHIP_SYSTEM.summary).toMatch(/Folder/i);
  });

  it("lists every BN1 family and later additions", () => {
    expect(BN1_CHIP_FAMILIES.length).toBeGreaterThanOrEqual(40);
    expect(LATER_CHIP_FAMILIES.length).toBeGreaterThanOrEqual(5);
    const ids = listedFamilyIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps every researched family onto an energy-fragment family", () => {
    for (const id of listedFamilyIds()) {
      expect(FAMILY_TO_FRAGMENT[id], id).toBeTruthy();
    }
  });
});

describe("energy fragment catalog", () => {
  it("has unique ids and library numbers", () => {
    const ids = ENERGY_FRAGMENTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const nos = ENERGY_FRAGMENTS.map((f) => f.libraryNo);
    expect(nos[0]).toBe(1);
    expect(nos.at(-1)).toBe(ENERGY_FRAGMENTS.length);
    expect(new Set(nos).size).toBe(nos.length);
  });

  it("requires name, class, element, summon, and source family on every row", () => {
    for (const f of ENERGY_FRAGMENTS) {
      expect(f.name).toBeTruthy();
      expect(["standard", "apex", "nova"]).toContain(f.class);
      expect(["void", "ember", "tide", "volt", "grove"]).toContain(f.element);
      expect(f.summon).toBeTruthy();
      expect(f.inspiredByFamily).toBeTruthy();
      expect(f.codes.length).toBeGreaterThan(0);
      expect(f.mb).toBeGreaterThan(0);
    }
  });

  it("covers every source family from the chip account", () => {
    const covered = new Set(coveredSourceFamilies());
    for (const id of listedFamilyIds()) {
      expect(covered.has(id), `missing playable variation for ${id}`).toBe(true);
    }
  });

  it("does not reuse Capcom Navi chip names as playable rows", () => {
    const banned = /^(roll|gutsman|protoman|fireman|bass|megaman)\b/i;
    for (const f of ENERGY_FRAGMENTS) {
      expect(banned.test(f.name)).toBe(false);
      expect(banned.test(f.id)).toBe(false);
    }
  });
});

describe("folder rules", () => {
  it("accepts the starter folder", () => {
    const folder = starterFolder();
    expect(folder).toHaveLength(FOLDER_RULES.size);
    const result = validateFolder(folder);
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });

  it("rejects a sixth Apex or a second Nova", () => {
    const folder = starterFolder();
    folder[0] = makeCopy("area-bloom");
    folder[1] = makeCopy("delta-veil");
    expect(validateFolder(folder).ok).toBe(false);
  });

  it("rejects a fifth copy of a Standard", () => {
    const folder = starterFolder().map((slot, i) =>
      i < 5 ? makeCopy("pulse-emitter") : slot,
    );
    expect(validateFolder(folder).ok).toBe(false);
  });
});

describe("custom selection and resonance", () => {
  it("links copies that share a name or a letter, including *", () => {
    expect(codesMatch(makeCopy("pulse-emitter", "A"), makeCopy("halo-burst", "A"))).toBe(true);
    expect(codesMatch(makeCopy("aether-sail", "*"), makeCopy("pulse-emitter", "B"))).toBe(true);
    expect(codesMatch(makeCopy("pulse-emitter", "A"), makeCopy("high-pulse", "L"))).toBe(false);
    expect(selectionIsLinked([makeCopy("phantom-edge"), makeCopy("phantom-edge")])).toBe(true);
  });

  it("fuses Pulse / Phantom / Seed / Prism sequences", () => {
    expect(findResonance(["pulse-emitter", "high-pulse", "apex-pulse"])?.id).toBe("nova-pulse");
    expect(findResonance(["phantom-edge", "wide-phantom", "long-phantom"])?.id).toBe("life-veil");
    expect(findResonance(["ember-seed", "twin-seed", "cross-seed"])?.id).toBe("chain-bloom");
    expect(findResonance(["prism-lance", "star-vein", "rift-needle"])?.id).toBe("prism-storm");
    expect(RESONANCE_COMBOS.every((c) => c.requires.every((id) => FRAGMENT_BY_ID[id]))).toBe(true);
  });
});

describe("element / tactic / virus match", () => {
  it("applies ember > grove > tide > ember and volt vs tide", () => {
    expect(elementMultiplier("ember", "grove")).toBe(2);
    expect(elementMultiplier("grove", "tide")).toBe(2);
    expect(elementMultiplier("tide", "ember")).toBe(2);
    expect(elementMultiplier("volt", "tide")).toBe(2);
    expect(elementMultiplier("volt", "volt")).toBe(2);
    expect(elementMultiplier("void", "ember")).toBe(1);
  });

  it("applies blade > gale > mark > shatter > blade", () => {
    expect(tacticMultiplier("blade", "gale")).toBe(2);
    expect(tacticMultiplier("gale", "mark")).toBe(2);
    expect(tacticMultiplier("mark", "shatter")).toBe(2);
    expect(tacticMultiplier("shatter", "blade")).toBe(2);
    expect(tacticMultiplier("none", "gale")).toBe(1);
  });

  it("marks volt fragments super-effective vs EvalWorm", () => {
    const spark = FRAGMENT_BY_ID["drift-spark"];
    const eff = effectivenessVsScan(spark, [{ codename: "EvalWorm", severity: "high" }]);
    expect(eff.multiplier).toBe(2);
    expect(eff.reasons.length).toBeGreaterThan(0);
  });

  it("ranks a hand so silence / high power rise against high-severity scans", () => {
    const hand = ["jack-out", "data-silence", "apex-pulse", "mend-10"].map((id) => FRAGMENT_BY_ID[id]);
    const ranked = rankHand(hand, [{ codename: "DataSiphon", severity: "high" }]);
    expect(ranked[0].fragment.id).not.toBe("jack-out");
    expect(ranked.map((r) => r.fragment.id)).toContain("data-silence");
  });
});

describe("draw and lore", () => {
  it("draws n copies without exceeding the folder", () => {
    const folder = starterFolder();
    const hand = drawHand(folder, 5, () => 0);
    expect(hand).toHaveLength(5);
    expect(hand.every((s) => FRAGMENT_BY_ID[s.id])).toBe(true);
  });

  it("exposes a prompt block for cyberspace sessions", () => {
    expect(energyFragmentLoreBlock()).toMatch(/ethereal/i);
    expect(energyFragmentLoreBlock()).toMatch(/Energy Fragment/i);
  });

  it("injects battle-data lore from the resolved character, not a later binding", () => {
    expect(
      cyberspaceBattlePromptBlock({ universe: "Mega Man Battle Network" }, {}),
    ).toMatch(/Energy Fragment/i);
    expect(
      cyberspaceBattlePromptBlock({}, { opening_scene: "jack into cyberspace" }),
    ).toMatch(/Energy Fragment/i);
    expect(
      cyberspaceBattlePromptBlock({ universe: "Naruto" }, { opening_scene: "a quiet village" }),
    ).toBe("");
  });

  it("throws if a helper closes over a later let (the Chat.jsx TDZ bug)", () => {
    const boom = () => {
      const cyberspaceBattleData = () => activeChar?.universe;
      cyberspaceBattleData();
      let activeChar = { universe: "Battle Network" };
      return activeChar;
    };
    expect(boom).toThrow(/before initialization/);
  });
});

describe("fragment library ownership", () => {
  it("starts operators with the Folder handful, not the full catalog", () => {
    const lib = defaultFragmentLibrary();
    expect(lib.granted_full_library).toBe(false);
    expect(lib.owned_ids).toEqual(starterOwnedIds());
    expect(lib.owned_ids.length).toBeGreaterThan(8);
    expect(lib.owned_ids.length).toBeLessThan(ENERGY_FRAGMENTS.length);
    expect(lib.folder).toHaveLength(FOLDER_RULES.size);
    expect(lib.owned_ids).not.toContain("hub-chorus");
  });

  it("grants every catalog id only when the steward flag is set", () => {
    expect(isEchoLibrarySteward({ email: "davins56@gmail.com" })).toBe(true);
    expect(isEchoLibrarySteward({ username: "davins56" })).toBe(true);
    expect(isEchoLibrarySteward({ role: "admin" })).toBe(false);
    expect(isEchoLibrarySteward({ email: "seeker@example.com" })).toBe(false);

    const steward = defaultFragmentLibrary({}, { grantFullLibrary: true });
    expect(steward.granted_full_library).toBe(true);
    expect(steward.owned_ids).toEqual(catalogOwnedIds());
    expect(steward.owned_ids).toHaveLength(ENERGY_FRAGMENTS.length);
    expect(steward.owned_ids).toEqual(expect.arrayContaining(["pulse-emitter", "hub-chorus"]));
    expect(steward.folder).toHaveLength(FOLDER_RULES.size);
  });

  it("does not expand a non-steward starter handful", () => {
    const stale = normalizeFragmentLibrary({
      granted_full_library: false,
      owned_ids: starterOwnedIds(),
    });
    expect(stale.granted_full_library).toBe(false);
    expect(stale.owned_ids).toEqual(starterOwnedIds());
    const granted = normalizeFragmentLibrary(
      { granted_full_library: false, owned_ids: starterOwnedIds() },
      { grantFullLibrary: true },
    );
    expect(granted.granted_full_library).toBe(true);
    expect(granted.owned_ids).toHaveLength(ENERGY_FRAGMENTS.length);
    expect(granted.folder).toHaveLength(FOLDER_RULES.size);
  });

  it("treats a starter handful as not yet the full library", () => {
    expect(storedFragmentLibraryIsFull({ granted_full_library: false, owned_ids: starterOwnedIds() }, ENERGY_FRAGMENTS.length)).toBe(false);
    expect(
      storedFragmentLibraryIsFull(
        { granted_full_library: true, owned_ids: ENERGY_FRAGMENTS.map((f) => f.id) },
        ENERGY_FRAGMENTS.length,
      ),
    ).toBe(true);
  });
});
