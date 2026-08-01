import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  characterList,
  animaList,
  notifyStoreChanged,
  retryStarterSeed,
  whenBootstrapReady,
} = vi.hoisted(() => ({
  characterList: vi.fn(),
  animaList: vi.fn(),
  notifyStoreChanged: vi.fn(),
  retryStarterSeed: vi.fn(),
  whenBootstrapReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Character: { list: characterList },
      Anima: { list: animaList },
    },
  },
  notifyStoreChanged,
}));

vi.mock("@/lib/seedCharacters", () => ({
  retryStarterSeed,
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady,
}));

async function loadModule() {
  vi.resetModules();
  return import("@/lib/loadRosterCharacters");
}

beforeEach(() => {
  characterList.mockReset();
  animaList.mockReset().mockResolvedValue([]);
  notifyStoreChanged.mockReset();
  retryStarterSeed.mockReset();
  whenBootstrapReady.mockReset().mockResolvedValue(undefined);
});

describe("loadRosterCharacters", () => {
  it("returns characters after bootstrap without retrying when the roster is populated", async () => {
    characterList.mockResolvedValue([
      { id: "seed_avatar-legend-of-korra-korra", name: "Korra" },
    ]);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters();

    expect(whenBootstrapReady).toHaveBeenCalled();
    expect(retryStarterSeed).not.toHaveBeenCalled();
    expect(result.rawCharacters).toHaveLength(1);
    expect(result.characters[0].name).toBe("Korra");
  });

  it("retries starter seeding when the character roster is empty", async () => {
    characterList
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "seed_avatar-legend-of-korra-korra", name: "Korra" },
      ]);
    retryStarterSeed.mockResolvedValue(1);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: true });

    expect(retryStarterSeed).toHaveBeenCalledTimes(1);
    expect(notifyStoreChanged).toHaveBeenCalled();
    expect(result.rawCharacters).toHaveLength(1);
    expect(result.characters.map((c) => c.name)).toContain("Korra");
  });

  it("does not retry seeding when retrySeed is false", async () => {
    characterList.mockResolvedValue([]);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(retryStarterSeed).not.toHaveBeenCalled();
    expect(result.characters).toEqual([]);
  });

  it("merges Anima rows into the chat roster", async () => {
    characterList.mockResolvedValue([
      { id: "seed_marvel-spider-man", name: "Spider-Man" },
    ]);
    animaList.mockResolvedValue([
      { id: "anima_1", name: "Serenity", archetype: "guardian" },
    ]);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(result.characters).toHaveLength(2);
    expect(result.characters[0]).toMatchObject({
      name: "Serenity",
      _isAnima: true,
      universe: "Anima",
    });
  });
});
