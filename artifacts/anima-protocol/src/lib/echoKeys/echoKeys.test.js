import { describe, expect, it } from "vitest";
import {
  ECHO_KEY_LIBRARY_SIZE,
  ECHO_KEYS,
  ECHO_KEY_BY_ID,
  echoKeysByMemory,
  normalizeEchoKeyAccount,
  starterEchoFolder,
  validateEchoFolder,
  setFolderSlots,
  chipsFromEchoFolder,
  echoKeyToChip,
  echoKeyLoreBlock,
} from "./index.js";

describe("Echo Key catalog", () => {
  it("holds 800 distinct weapon-memories", () => {
    expect(ECHO_KEY_LIBRARY_SIZE).toBe(800);
    expect(ECHO_KEYS).toHaveLength(800);
    const ids = ECHO_KEYS.map((k) => k.id);
    expect(new Set(ids).size).toBe(800);
    expect(ECHO_KEYS[0].libraryNo).toBe(1);
    expect(ECHO_KEYS.at(-1).libraryNo).toBe(800);
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
  it("builds a valid 30-slot starter folder", () => {
    const folder = starterEchoFolder();
    expect(folder).toHaveLength(30);
    expect(validateEchoFolder(folder).ok).toBe(true);
  });

  it("grants the full 800-key library on an empty profile", () => {
    const account = normalizeEchoKeyAccount(null);
    expect(account.owned).toHaveLength(800);
    expect(account.granted_full_library).toBe(true);
    expect(account.folders[0].slots).toHaveLength(30);
    expect(validateEchoFolder(account.folders[0].slots).ok).toBe(true);
  });

  it("keeps a custom folder when it is legal", () => {
    const starter = starterEchoFolder();
    const account = normalizeEchoKeyAccount({
      granted_full_library: true,
      folders: [{ id: "alpha", name: "Alpha", slots: starter }],
      active_folder_id: "alpha",
    });
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

describe("Echo Key combat mapping", () => {
  it("maps a folder onto NetBattle chips", () => {
    const chips = chipsFromEchoFolder(starterEchoFolder());
    expect(chips.length).toBe(30);
    expect(["blast", "sword", "area", "heal"]).toContain(chips[0].kind);
    const pulse = echoKeyToChip(ECHO_KEY_BY_ID["pulse-emitter"], "A");
    expect(pulse.kind).toBe("blast");
    expect(pulse.damage).toBeGreaterThan(0);
  });

  it("describes the library in lore", () => {
    expect(echoKeyLoreBlock()).toMatch(/ECHO KEYS/i);
    expect(echoKeyLoreBlock()).toMatch(/800/);
    expect(echoKeyLoreBlock()).toMatch(/Star Force/i);
  });
});
