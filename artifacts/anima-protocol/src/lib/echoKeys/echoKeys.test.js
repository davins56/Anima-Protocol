import { describe, expect, it } from "vitest";
import {
  ECHO_KEY_LIBRARY_SIZE,
  ECHO_KEYS,
  ECHO_KEY_BY_ID,
  FEATURED_RESONANCE_KEYS,
  echoKeysByMemory,
  normalizeEchoKeyAccount,
  starterEchoFolder,
  starterOwnedIds,
  validateEchoFolder,
  setFolderSlots,
  chipsFromEchoFolder,
  echoKeyToChip,
  echoKeyLoreBlock,
  echoKeyCanonLine,
  enrichEchoKey,
  discoverAtSite,
  synthesiseEchoKeys,
  recordCriticalBattle,
  biomeFromCoords,
  siteIdFromBiome,
  grantOwnedKey,
} from "./index.js";

describe("Echo Key catalog", () => {
  it("holds 800 distinct Codex entries", () => {
    expect(ECHO_KEY_LIBRARY_SIZE).toBe(800);
    expect(ECHO_KEYS).toHaveLength(800);
    const ids = ECHO_KEYS.map((k) => k.id);
    expect(new Set(ids).size).toBe(800);
    expect(ECHO_KEYS[0].libraryNo).toBe(1);
    expect(ECHO_KEYS.at(-1).libraryNo).toBe(800);
  });

  it("includes featured resonance artifacts", () => {
    for (const row of FEATURED_RESONANCE_KEYS) {
      expect(ECHO_KEY_BY_ID[row.id], row.id).toBeTruthy();
    }
    expect(ECHO_KEY_BY_ID["last-ember"].name).toBe("Last Ember");
    expect(ECHO_KEY_BY_ID["ember-that-refused"].name).toBe("Ember That Refused");
  });

  it("covers Battle Network classes, Star Force memories, and Dark/Plus", () => {
    const memories = new Set(ECHO_KEYS.map((k) => k.memory));
    for (const m of ["weapon", "plus", "field", "dark", "wave", "brother", "nova"]) {
      expect(memories.has(m), m).toBe(true);
    }
    const eras = new Set(ECHO_KEYS.map((k) => k.era));
    for (const era of ["bn1", "bn2", "bn3", "bn4", "bn5", "bn6", "starforce"]) {
      expect(eras.has(era), era).toBe(true);
    }
    expect(echoKeysByMemory("wave").length).toBeGreaterThan(20);
    expect(echoKeysByMemory("dark").length).toBeGreaterThan(5);
  });

  it("does not reuse Capcom chip or Navi names as playable rows", () => {
    const banned = /^(cannon|hicannon|sword|wideswrd|roll|gutsman|protoman|fireman|bass|megaman|airshot|vulcan)\b/i;
    for (const key of ECHO_KEYS) {
      expect(banned.test(key.name), key.name).toBe(false);
    }
  });

  it("requires codes, summon, and a source family on every key", () => {
    for (const key of ECHO_KEYS) {
      expect(key.codes.length).toBeGreaterThan(0);
      expect(key.summon).toBeTruthy();
      expect(key.inspiredByFamily).toBeTruthy();
      expect(["standard", "apex", "nova"]).toContain(key.class);
    }
  });
});

describe("Echo Key folders and profile account", () => {
  it("starts with Shards, not the full Codex", () => {
    const folder = starterEchoFolder();
    expect(folder.length).toBeGreaterThanOrEqual(8);
    expect(folder.length).toBeLessThanOrEqual(30);
    expect(validateEchoFolder(folder).ok).toBe(true);

    const account = normalizeEchoKeyAccount(null);
    expect(account.owned).toEqual(starterOwnedIds());
    expect(account.owned.length).toBe(8);
    expect(account.granted_full_library).toBe(false);
    expect(account.folders[0].slots).toHaveLength(8);
  });

  it("keeps a legacy full-library grant", () => {
    const starter = starterEchoFolder();
    const account = normalizeEchoKeyAccount({
      granted_full_library: true,
      folders: [{ id: "alpha", name: "Alpha", slots: starter }],
      active_folder_id: "alpha",
    });
    expect(account.owned).toHaveLength(800);
    expect(account.granted_full_library).toBe(true);
    expect(account.active_folder_id).toBe("alpha");
    const next = setFolderSlots(account, "alpha", starter);
    expect(next.ok).toBe(true);
  });

  it("rejects a folder with too many Nova keys", () => {
    const novas = ECHO_KEYS.filter((k) => k.class === "nova").slice(0, 2);
    if (novas.length < 2) return;
    const slots = starterEchoFolder();
    slots[0] = { id: novas[0].id, code: novas[0].codes[0] };
    slots[1] = { id: novas[1].id, code: novas[1].codes[0] };
    expect(validateEchoFolder(slots).ok).toBe(false);
  });
});

describe("Resonance metadata", () => {
  it("treats Last Ember as a Key, not a shop Prime", () => {
    const ember = enrichEchoKey(ECHO_KEY_BY_ID["last-ember"]);
    expect(ember.tier).toBe("key");
    expect(ember.frequency).toBe("pyric");
    expect(ember.evolution.into).toBe("ember-that-refused");
    expect(echoKeyCanonLine()).toMatch(/crystallized memories of function/i);
  });
});

describe("Story-mode discovery", () => {
  it("finds a new Key at a ruin without granting the Codex", () => {
    const account = normalizeEchoKeyAccount(null);
    const result = discoverAtSite(account, "fallen-ruin", { rng: () => 0, now: 1_700_000_000_000 });
    expect(result.ok).toBe(true);
    expect(result.key).toBeTruthy();
    expect(result.account.owned).toContain(result.key.id);
    expect(result.account.owned.length).toBe(account.owned.length + 1);
    expect(result.account.granted_full_library).toBe(false);
  });

  it("respects virtual attune cooldown", () => {
    const account = normalizeEchoKeyAccount(null);
    const first = discoverAtSite(account, "ancient-forest", { rng: () => 0.2, now: 1_700_000_000_000 });
    expect(first.ok).toBe(true);
    const second = discoverAtSite(first.account, "ancient-forest", {
      rng: () => 0.2,
      now: 1_700_000_000_000 + 60_000,
    });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/settling/i);
  });

  it("synthesises Firestorm from Pyre + Gale", () => {
    let account = normalizeEchoKeyAccount(null);
    account = grantOwnedKey(account, "pyre-key");
    account = grantOwnedKey(account, "gale-key");
    const result = synthesiseEchoKeys(account, ["pyre-key", "gale-key"]);
    expect(result.ok).toBe(true);
    expect(result.key.id).toBe("firestorm");
    expect(result.account.owned).toContain("firestorm");
  });

  it("synthesises Mourning Gate from Grief + Memory + Veil", () => {
    let account = normalizeEchoKeyAccount(null);
    account = grantOwnedKey(account, "grief-echo");
    account = grantOwnedKey(account, "memory-echo");
    account = grantOwnedKey(account, "veil-key");
    const result = synthesiseEchoKeys(account, ["grief-echo", "memory-echo", "veil-key"]);
    expect(result.ok).toBe(true);
    expect(result.key.id).toBe("mourning-gate");
  });

  it("evolves Last Ember after three critical survivals", () => {
    let account = grantOwnedKey(normalizeEchoKeyAccount(null), "last-ember");
    for (let i = 0; i < 2; i += 1) {
      const step = recordCriticalBattle(account, {
        folderIds: ["last-ember"],
        integrityRatio: 0.2,
        survived: true,
      });
      expect(step.progressed).toBe(true);
      expect(step.evolved).toBeNull();
      account = step.account;
    }
    const done = recordCriticalBattle(account, {
      folderIds: ["last-ember"],
      integrityRatio: 0.15,
      survived: true,
    });
    expect(done.evolved.id).toBe("ember-that-refused");
    expect(done.account.owned).toContain("ember-that-refused");
  });

  it("classifies field coordinates into a biome without needing the raw point later", () => {
    expect(biomeFromCoords(67, 20)).toBe("celestial");
    expect(biomeFromCoords(58, 10)).toBe("mountain");
    expect(typeof siteIdFromBiome(biomeFromCoords(45, -122))).toBe("string");
  });
});

describe("Echo Key combat mapping", () => {
  it("maps a Resonance Array onto NetBattle chips", () => {
    const chips = chipsFromEchoFolder(starterEchoFolder());
    expect(chips.length).toBe(8);
    expect(["blast", "sword", "area", "heal"]).toContain(chips[0].kind);
    const pulse = echoKeyToChip(ECHO_KEY_BY_ID["pulse-emitter"], "A");
    expect(pulse.kind).toBe("blast");
    expect(pulse.damage).toBeGreaterThan(0);
  });

  it("describes Keys as crystallized function, not a full starting library", () => {
    expect(echoKeyLoreBlock()).toMatch(/crystallized memories of function/i);
    expect(echoKeyLoreBlock()).toMatch(/800/);
    expect(echoKeyLoreBlock()).toMatch(/handful of Shards/i);
  });
});
