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
  FEATURED_RESONANCE_KEYS,
  CANON_ECHO_KEYS,
  CANON_ECHO_KEY_NAMES,
  CANON_RESONANCE,
  BINARY_SIGIL_IDS,
  FIFTH_TONE_IDS,
  CHOIR_SOVEREIGN_IDS,
  TIER_LABEL,
  tierOf,
  makeEchoCopy,
  starterEchoFolder,
  starterOwnedIds,
  validateEchoFolder,
  echoCodesMatch,
  echoSelectionIsLinked,
  findEchoResonance,
  findBestLink,
  echoElementMultiplier,
  defaultEchoLibrary,
  normalizeEchoLibrary,
  echoFolderToChips,
  chipsFromEchoFolder,
  echoKeyToChip,
  echoResonanceChip,
  echoFolderStats,
  echoKeyLoreBlock,
  echoKeyPromptBlock,
  echoKeyCanonLine,
  enrichEchoKey,
  discoverAtSite,
  synthesiseEchoKeys,
  recordCriticalBattle,
  grantOwnedKey,
  normalizeEchoKeyAccount,
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
    expect(ECHO_FAMILIES.length * VARIANT_SLOTS.length).toBe(800);
    expect(ECHO_KEYS.length).toBeGreaterThanOrEqual(800);
    expect(ECHO_LIBRARY_SIZE).toBe(ECHO_KEYS.length);
  });

  it("has unique ids, names, and library numbers", () => {
    const ids = ECHO_KEYS.map((k) => k.id);
    const names = ECHO_KEYS.map((k) => k.name);
    const nos = ECHO_KEYS.map((k) => k.libraryNo);
    expect(new Set(ids).size).toBe(ECHO_KEYS.length);
    expect(new Set(names).size).toBe(ECHO_KEYS.length);
    expect(nos[0]).toBe(1);
    expect(nos.at(-1)).toBe(ECHO_KEYS.length);
    expect(new Set(nos).size).toBe(ECHO_KEYS.length);
  });

  it("includes featured resonance artifacts", () => {
    for (const row of FEATURED_RESONANCE_KEYS) {
      expect(ECHO_KEY_BY_ID[row.id], row.id).toBeTruthy();
    }
    expect(ECHO_KEY_BY_ID["last-ember"].name).toBe("Last Ember");
  });

  it("catalogs every named novel artifact with the right tier", () => {
    expect(CANON_ECHO_KEYS.length).toBe(CANON_ECHO_KEY_NAMES.length);
    for (const name of CANON_ECHO_KEY_NAMES) {
      const key = ECHO_KEYS.find((k) => k.name === name);
      expect(key, name).toBeTruthy();
      expect(key.sources).toEqual(expect.arrayContaining(["canon", "novel"]));
      expect(["shard", "key", "sovereign", "prime"]).toContain(key.tier);
      expect(tierOf(key)).toBe(key.tier);
    }
    expect(ECHO_KEY_BY_ID.beth.name).toBe("Beth / Home");
    expect(ECHO_KEY_BY_ID["echo-memory"].name).toBe("Memory");
    expect(ECHO_KEY_BY_ID["choir-memory"].name).toBe("Memory (Choir)");
    expect(ECHO_KEY_BY_ID["echo-memory"].id).not.toBe(ECHO_KEY_BY_ID["choir-memory"].id);
    expect(tierOf(ECHO_KEY_BY_ID.aleph)).toBe("shard");
    expect(tierOf(ECHO_KEY_BY_ID.empathy || ECHO_KEY_BY_ID["echo-empathy"])).toBe("key");
    expect(tierOf(ECHO_KEY_BY_ID["choir-love"])).toBe("sovereign");
    expect(tierOf(ECHO_KEY_BY_ID["prime-echo-key"])).toBe("prime");
    expect(tierOf(ECHO_KEY_BY_ID["last-ember"])).toBe("key");
    expect(TIER_LABEL.shard).toBe("Echo Shard");
    expect(TIER_LABEL.key).toBe("Echo Key");
    expect(TIER_LABEL.sovereign).toBe("Sovereign Key");
    expect(TIER_LABEL.prime).toBe("Prime Key");
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
    const capcomChips = /^(cannon|hi-cannon|sword|wide sword|long sword|folder|area grab|barrier)$/i;
    for (const key of ECHO_KEYS) {
      expect(banned.test(key.name)).toBe(false);
      expect(banned.test(key.id)).toBe(false);
      expect(capcomChips.test(key.name)).toBe(false);
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
  it("accepts the starter Array and does not grant the Codex", () => {
    const folder = starterEchoFolder();
    expect(folder).toHaveLength(ECHO_FOLDER_RULES.size);
    const result = validateEchoFolder(folder);
    expect(result.ok, result.errors.join("; ")).toBe(true);
    const lib = defaultEchoLibrary();
    expect(lib.owned_ids).toEqual(starterOwnedIds());
    expect(lib.owned_ids).toHaveLength(11);
    expect(lib.owned_ids).toEqual(expect.arrayContaining(["beth", "gimel", "he"]));
    expect(lib.owned_ids).not.toContain("prime-echo-key");
    expect(lib.owned_ids).not.toContain("wheel-crown");
    expect(lib.owned_ids).not.toContain("final-sigil");
    expect(lib.granted_full_library).toBe(false);
    expect(lib.folder).toHaveLength(30);
    expect(lib.regular_id).toBe("pulse-base");
    expect(lib.star_card_id).toBeNull();
  });

  it("rejects a second Star or a fifth Standard copy", () => {
    const folder = starterEchoFolder();
    folder[0] = makeEchoCopy("halo-star");
    folder[1] = makeEchoCopy("pulse-star");
    expect(validateEchoFolder(folder).ok).toBe(false);
    const tooMany = starterEchoFolder().map((slot, i) =>
      i < 5 ? makeEchoCopy("pulse-base") : slot,
    );
    expect(validateEchoFolder(tooMany).ok).toBe(false);
  });

  it("restores a saved folder from profile JSON", () => {
    const saved = defaultEchoLibrary();
    saved.owned_ids = [...saved.owned_ids, "magnumlock-base"];
    saved.folder[0] = makeEchoCopy("magnumlock-base");
    const next = normalizeEchoLibrary(saved);
    expect(next.folder[0].id).toBe("magnumlock-base");
    expect(normalizeEchoLibrary(null).owned_ids).toHaveLength(11);
    const legacy = normalizeEchoLibrary({ granted_full_library: true });
    expect(legacy.owned_ids.length).toBe(ECHO_KEYS.length);
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

  it("resolves novel Resonance Combos without fusing Echo of Glass", () => {
    expect(findEchoResonance(["daleth", "zayin", "beth"])?.name).toBe("CATENA/SHIELD");
    expect(findEchoResonance(["kaph", "he", "gimel"])?.name).toBe("KAPH/GLORIA");
    expect(findEchoResonance(["lamed", "zayin", "saltloop", "censer"])?.name).toBe("LAMED/VIGIL");
    expect(findEchoResonance(["tet", "beth", "vav", "yod"])?.name).toBe("TET/COMMONS");
    expect(findEchoResonance(["vav", "beth"])?.name).toBe("SUTURE");
    expect(findEchoResonance(FIFTH_TONE_IDS)?.id).toBe("fifth-tone");
    expect(findEchoResonance(FIFTH_TONE_IDS)?.relation).toBe(true);
    expect(echoResonanceChip(FIFTH_TONE_IDS)).toBeNull();
    expect(findEchoResonance(BINARY_SIGIL_IDS)?.name).toBe("Wheel / Crown");
    expect(findEchoResonance(["equinox"])?.name).toBe("The Final Sigil");
    expect(findEchoResonance(CHOIR_SOVEREIGN_IDS)).toBeNull();
    expect(CANON_RESONANCE.every((c) => c.requires.every((id) => ECHO_KEY_BY_ID[id]))).toBe(true);
    const shield = echoResonanceChip(["daleth", "zayin", "beth"]);
    expect(shield?.name).toBe("CATENA/SHIELD");
  });

  it("caps Resonance Array copies by novel tier", () => {
    const withBeth = starterEchoFolder().map((slot, i) => (i < 4 ? makeEchoCopy("beth") : slot));
    expect(validateEchoFolder(withBeth).ok).toBe(true);
    const fiveBeth = starterEchoFolder().map((slot, i) => (i < 5 ? makeEchoCopy("beth") : slot));
    expect(validateEchoFolder(fiveBeth).ok).toBe(false);
    const twoEmpathy = [
      ...starterEchoFolder().slice(0, 28),
      makeEchoCopy("echo-empathy"),
      makeEchoCopy("echo-empathy"),
    ];
    expect(validateEchoFolder(twoEmpathy).ok).toBe(false);
    const twoSovereign = [
      ...starterEchoFolder().slice(0, 28),
      makeEchoCopy("choir-compassion"),
      makeEchoCopy("choir-courage"),
    ];
    expect(validateEchoFolder(twoSovereign).ok).toBe(false);
    const twoPrime = [
      ...starterEchoFolder().slice(0, 28),
      makeEchoCopy("resonance-alpha"),
      makeEchoCopy("prime-echo-key"),
    ];
    expect(validateEchoFolder(twoPrime).ok).toBe(false);
    const oneEach = [
      ...starterEchoFolder().slice(0, 27),
      makeEchoCopy("echo-empathy"),
      makeEchoCopy("choir-compassion"),
      makeEchoCopy("prime-echo-key"),
    ];
    expect(validateEchoFolder(oneEach).ok).toBe(true);
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
    const chips = echoFolderToChips({
      ...defaultEchoLibrary(),
      star_card_id: "pulse-star",
    });
    expect(chips.length).toBeGreaterThanOrEqual(30);
    expect(chips[0].id).toBe("pulse-base");
    expect(chips.some((c) => c.id === "pulse-star")).toBe(true);
    const fused = echoResonanceChip(["pulse-base", "pulse-high", "pulse-apex"]);
    expect(fused?.name).toBe("Nova Pulse");
    expect(fused?.damage).toBe(400);
    const fromSlots = chipsFromEchoFolder([
      { id: "pulse-base", code: "A" },
      { id: "phantom-base", code: "S" },
    ]);
    expect(fromSlots).toHaveLength(2);
    expect(fromSlots.every((chip) => chip.kind && chip.echoKey)).toBe(true);
  });

  it("summarizes folder stats for analytics", () => {
    const stats = echoFolderStats(defaultEchoLibrary());
    expect(stats.folder_size).toBe(30);
    expect(stats.owned_count).toBe(11);
    expect(stats.star_count).toBe(0);
    expect(stats.mega_count).toBe(0);
  });

  it("exposes a prompt block for cyberspace sessions", () => {
    expect(echoKeyLoreBlock()).toMatch(/Echo Key/i);
    expect(echoKeyLoreBlock()).toMatch(/800/);
    expect(echoKeyPromptBlock({ universe: "Mega Man Battle Network" }, {})).toMatch(/weapon-memory/i);
    expect(echoKeyPromptBlock({ universe: "Star Force" }, {})).toMatch(/Folder/);
    expect(echoKeyPromptBlock({ universe: "Naruto" }, { opening_scene: "a quiet village" })).toBe("");
  });
});

describe("story-mode discovery", () => {
  it("starts the account with Shards, not the Codex", () => {
    const account = normalizeEchoKeyAccount(null);
    expect(account.owned).toEqual(starterOwnedIds());
    expect(account.granted_full_library).toBe(false);
    expect(echoKeyCanonLine()).toMatch(/crystallized memories of function/i);
    expect(enrichEchoKey(ECHO_KEY_BY_ID["last-ember"]).tier).toBe("key");
  });

  it("finds a Key at a ruin and synthesises Firestorm and Mourning Gate", () => {
    const account = normalizeEchoKeyAccount(null);
    const ruin = discoverAtSite(account, "fallen-ruin", { rng: () => 0.1, now: 1_700_000_000_000 });
    expect(ruin.ok).toBe(true);
    expect(ruin.account.owned.length).toBe(account.owned.length + 1);

    let fused = grantOwnedKey(account, "pyre-key");
    fused = grantOwnedKey(fused, "gale-key");
    const storm = synthesiseEchoKeys(fused, ["pyre-key", "gale-key"]);
    expect(storm.ok).toBe(true);
    expect(storm.key.id).toBe("firestorm");

    fused = grantOwnedKey(account, "grief-echo");
    fused = grantOwnedKey(fused, "memory-echo");
    fused = grantOwnedKey(fused, "veil-key");
    const gate = synthesiseEchoKeys(fused, ["grief-echo", "memory-echo", "veil-key"]);
    expect(gate.ok).toBe(true);
    expect(gate.key.id).toBe("mourning-gate");

    fused = grantOwnedKey(account, "vav");
    fused = grantOwnedKey(fused, "beth");
    const stitched = synthesiseEchoKeys(fused, ["vav", "beth"]);
    expect(stitched.ok).toBe(true);
    expect(stitched.key.id).toBe("suture");
    expect(stitched.key.tier).toBe("key");
  });

  it("evolves Last Ember after three critical survivals", () => {
    let account = grantOwnedKey(normalizeEchoKeyAccount(null), "last-ember");
    for (let i = 0; i < 2; i += 1) {
      const step = recordCriticalBattle(account, {
        folderIds: ["last-ember"],
        integrityRatio: 0.2,
        survived: true,
      });
      expect(step.evolved).toBeNull();
      account = step.account;
    }
    const done = recordCriticalBattle(account, {
      folderIds: ["last-ember"],
      integrityRatio: 0.15,
      survived: true,
    });
    expect(done.evolved.id).toBe("ember-that-refused");
  });
});
