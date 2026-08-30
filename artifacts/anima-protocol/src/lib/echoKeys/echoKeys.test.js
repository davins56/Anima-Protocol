import { describe, it, expect } from "vitest";
import {
  ECHO_KEYS,
  ECHO_LIBRARY_SIZE,
  ECHO_KEY_BY_ID,
  ECHO_FAMILIES,
  VARIANT_SLOTS,
  familyIds,
  coveredInspiredBy,
  BATTLE_CHIP_LINEAGE,
  STAR_FORCE_CARD_LINEAGE,
  ECHO_KEY_SYSTEM,
  BN_LATER_FAMILY_ACCOUNT,
  STAR_FORCE_FAMILY_ACCOUNT,
  laterFamilyIds,
  starForceFamilyIds,
  ECHO_FOLDER_RULES,
  ECHO_RESONANCE,
  makeEchoCopy,
  starterEchoFolder,
  validateEchoFolder,
  echoCodesMatch,
  echoSelectionIsLinked,
  findEchoResonance,
  findBestLink,
  echoElementMultiplier,
  defaultEchoLibrary,
  normalizeEchoLibrary,
  echoFolderToChips,
  echoKeyToChip,
  echoResonanceChip,
  echoFolderStats,
  echoKeyLoreBlock,
  echoKeyPromptBlock,
} from "./index.js";

describe("research account", () => {
  it("documents BN 1–6 chip lineage and Star Force cards", () => {
    expect(BATTLE_CHIP_LINEAGE.summary).toMatch(/Folder/i);
    expect(BATTLE_CHIP_LINEAGE.versions).toMatch(/Gregar/);
    expect(STAR_FORCE_CARD_LINEAGE.summary).toMatch(/Best Combo/);
    expect(STAR_FORCE_CARD_LINEAGE.summary).toMatch(/Brother Band/);
    expect(ECHO_KEY_SYSTEM.summary).toMatch(/800/);
  });

  it("lists later BN and Star Force families without duplicate ids", () => {
    expect(BN_LATER_FAMILY_ACCOUNT.length).toBeGreaterThanOrEqual(15);
    expect(STAR_FORCE_FAMILY_ACCOUNT.length).toBeGreaterThanOrEqual(12);
    const ids = [...laterFamilyIds(), ...starForceFamilyIds()];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("echo key catalog", () => {
  it("holds around 800 distinct keys", () => {
    expect(ECHO_FAMILIES.length).toBe(80);
    expect(VARIANT_SLOTS.length).toBe(10);
    expect(ECHO_LIBRARY_SIZE).toBe(800);
    expect(ECHO_KEYS.length).toBe(800);
  });

  it("has unique ids, names, and library numbers", () => {
    const ids = ECHO_KEYS.map((k) => k.id);
    const names = ECHO_KEYS.map((k) => k.name);
    const nos = ECHO_KEYS.map((k) => k.libraryNo);
    expect(new Set(ids).size).toBe(800);
    expect(new Set(names).size).toBe(800);
    expect(nos[0]).toBe(1);
    expect(nos.at(-1)).toBe(800);
    expect(new Set(nos).size).toBe(800);
  });

  it("requires class, element, kind, memory, and codes on every key", () => {
    for (const key of ECHO_KEYS) {
      expect(key.name).toBeTruthy();
      expect(["standard", "mega", "star", "dark", "giga"]).toContain(key.class);
      expect(["void", "ember", "tide", "volt", "grove"]).toContain(key.element);
      expect(key.kind).toBeTruthy();
      expect(key.memory).toMatch(/Remembers/);
      expect(key.ability?.tag).toBeTruthy();
      expect(key.codes.length).toBeGreaterThan(0);
      expect(key.mb).toBeGreaterThan(0);
      expect(key.inspiredBy).toBeTruthy();
      expect(key.sources.length).toBeGreaterThan(0);
    }
  });

  it("covers BN and Star Force research families as inspired-by pointers", () => {
    const covered = coveredInspiredBy();
    expect(covered).toContain("cannon");
    expect(covered).toContain("sword");
    expect(covered).toContain("plasma");
    expect(covered).toContain("best-combo");
    expect(covered).toContain("noise");
    expect(covered).toContain("tribe");
    expect(covered).toContain("cross");
    expect(familyIds().length).toBe(80);
  });

  it("does not reuse Capcom Navi or card names as playable rows", () => {
    const banned = /^(roll|gutsman|protoman|fireman|bass|megaman|omega-xis|geo stare|pegasus|leo|dragon)\b/i;
    for (const key of ECHO_KEYS) {
      expect(banned.test(key.name)).toBe(false);
      expect(banned.test(key.id)).toBe(false);
    }
  });

  it("gives each family ten varying abilities", () => {
    const pulse = ECHO_KEYS.filter((k) => k.family === "pulse");
    expect(pulse.map((k) => k.ability.tag)).toEqual([
      "base",
      "pierce",
      "heavy",
      "burn",
      "push",
      "chain",
      "root",
      "lockon",
      "multihit",
      "echo-debt",
    ]);
    expect(pulse.find((k) => k.id === "pulse-star")?.class).toBe("star");
    expect(pulse.find((k) => k.id === "pulse-noise")?.class).toBe("mega");
    expect(pulse.find((k) => k.id === "pulse-shade")?.class).toBe("dark");
    expect(ECHO_KEY_BY_ID["cybreath-shade"]?.class).toBe("giga");
  });
});

describe("folder and profile library", () => {
  it("accepts the starter folder and grants the full library to a profile", () => {
    const folder = starterEchoFolder();
    expect(folder).toHaveLength(ECHO_FOLDER_RULES.size);
    const result = validateEchoFolder(folder);
    expect(result.ok, result.errors.join("; ")).toBe(true);
    const lib = defaultEchoLibrary();
    expect(lib.owned_ids).toHaveLength(800);
    expect(lib.folder).toHaveLength(30);
    expect(lib.regular_id).toBe("pulse-base");
    expect(lib.star_card_id).toBe("pulse-star");
  });

  it("rejects a second Star or a fifth Standard copy", () => {
    const folder = starterEchoFolder();
    folder[0] = makeEchoCopy("halo-star");
    expect(validateEchoFolder(folder).ok).toBe(false);
    const tooMany = starterEchoFolder().map((slot, i) =>
      i < 5 ? makeEchoCopy("pulse-base") : slot,
    );
    expect(validateEchoFolder(tooMany).ok).toBe(false);
  });

  it("restores a saved folder from profile JSON", () => {
    const saved = defaultEchoLibrary();
    saved.folder[0] = makeEchoCopy("magnumlock-base");
    const next = normalizeEchoLibrary(saved);
    expect(next.folder[0].id).toBe("magnumlock-base");
    expect(normalizeEchoLibrary(null).owned_ids).toHaveLength(800);
  });

  it("links copies that share a name, family, or letter, including *", () => {
    expect(echoCodesMatch(makeEchoCopy("pulse-base"), makeEchoCopy("pulse-base"))).toBe(true);
    expect(echoSelectionIsLinked([makeEchoCopy("pulse-base"), makeEchoCopy("pulse-high")])).toBe(true);
    expect(echoCodesMatch({ id: "pulse-base", code: "*" }, { id: "halo-high", code: "Q" })).toBe(true);
    expect(echoCodesMatch({ id: "pulse-high", code: "L" }, { id: "halo-apex", code: "Q" })).toBe(false);
  });

  it("fuses Pulse / Phantom / Seed / Star Force sequences", () => {
    expect(findEchoResonance(["pulse-base", "pulse-high", "pulse-apex"])?.id).toBe("nova-pulse");
    expect(findEchoResonance(["phantom-base", "phantom-high", "phantom-apex"])?.id).toBe("life-veil");
    expect(findBestLink(["plasmagun-base", "heatupper-base", "iceneedle-base"])?.id).toBe("star-best");
    expect(findBestLink(["pulse-star", "halo-star", "seed-star"])?.id).toBe("star-triad");
    expect(findBestLink(["mend-base", "mend-high", "mend-apex"])?.id).toMatch(/^best-/);
    expect(ECHO_RESONANCE.every((c) => c.requires.every((id) => ECHO_KEY_BY_ID[id]))).toBe(true);
  });

  it("applies ember > grove > tide and volt vs tide", () => {
    expect(echoElementMultiplier("ember", "grove")).toBe(2);
    expect(echoElementMultiplier("volt", "tide")).toBe(2);
    expect(echoElementMultiplier("void", "ember")).toBe(1);
  });
});

describe("combat adapter and lore", () => {
  it("maps echo keys onto NetBattle chip kinds", () => {
    const blast = echoKeyToChip(ECHO_KEY_BY_ID["pulse-base"]);
    expect(blast.kind).toBe("blast");
    expect(blast.damage).toBeGreaterThan(0);
    expect(blast.echoKey).toBe(true);
    const sword = echoKeyToChip(ECHO_KEY_BY_ID["phantom-high"]);
    expect(sword.kind).toBe("sword");
    expect(sword.wide).toBe(true);
    const heal = echoKeyToChip(ECHO_KEY_BY_ID["mend-base"]);
    expect(heal.kind).toBe("heal");
    expect(heal.heal).toBeGreaterThan(0);
  });

  it("builds a playable folder with Regular and Star-Force pins", () => {
    const chips = echoFolderToChips(defaultEchoLibrary());
    expect(chips.length).toBeGreaterThanOrEqual(30);
    expect(chips[0].id).toBe("pulse-base");
    expect(chips.some((c) => c.id === "pulse-star")).toBe(true);
    const fused = echoResonanceChip(["pulse-base", "pulse-high", "pulse-apex"]);
    expect(fused?.name).toBe("Nova Pulse");
    expect(fused?.damage).toBe(400);
  });

  it("summarizes folder stats for analytics", () => {
    const stats = echoFolderStats(defaultEchoLibrary());
    expect(stats.folder_size).toBe(30);
    expect(stats.owned_count).toBe(800);
    expect(stats.star_count).toBe(1);
    expect(stats.mega_count).toBe(1);
  });

  it("exposes a prompt block for cyberspace sessions", () => {
    expect(echoKeyLoreBlock()).toMatch(/Echo Key/i);
    expect(echoKeyLoreBlock()).toMatch(/800/);
    expect(echoKeyPromptBlock({ universe: "Mega Man Battle Network" }, {})).toMatch(/weapon-memory/i);
    expect(echoKeyPromptBlock({ universe: "Star Force" }, {})).toMatch(/Folder/);
    expect(echoKeyPromptBlock({ universe: "Naruto" }, { opening_scene: "a quiet village" })).toBe("");
  });
});
