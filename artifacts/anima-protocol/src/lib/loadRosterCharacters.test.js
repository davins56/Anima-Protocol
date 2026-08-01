import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  characterList,
  animaList,
  notifyStoreChanged,
  waitForStoreAuth,
  retryStarterSeed,
  getStarterRoster,
  whenBootstrapReady,
} = vi.hoisted(() => ({
  characterList: vi.fn(),
  animaList: vi.fn(),
  notifyStoreChanged: vi.fn(),
  waitForStoreAuth: vi.fn().mockResolvedValue("token"),
  retryStarterSeed: vi.fn(),
  getStarterRoster: vi.fn(() => [
    {
      id: "seed_avatar-legend-of-korra-korra",
      name: "Korra",
      universe: "Avatar: Legend of Korra",
    },
  ]),
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
  waitForStoreAuth,
}));

vi.mock("@/lib/seedCharacters", () => ({
  retryStarterSeed,
  getStarterRoster,
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
  waitForStoreAuth.mockReset().mockResolvedValue("token");
  retryStarterSeed.mockReset();
  getStarterRoster.mockClear();
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
    expect(waitForStoreAuth).toHaveBeenCalled();
    expect(retryStarterSeed).not.toHaveBeenCalled();
    expect(result.rawCharacters).toHaveLength(1);
    expect(result.characters[0].name).toBe("Korra");
    expect(result.usingBundledSeed).toBe(false);
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
    expect(result.usingBundledSeed).toBe(false);
  });

  it("does not retry seeding when retrySeed is false", async () => {
    characterList.mockResolvedValue([]);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({
      retrySeed: false,
      allowBundledFallback: false,
    });

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

  it("falls back to bundled starters when store DB is down after seed retry", async () => {
    const err = Object.assign(new Error("Database unavailable"), {
      status: 503,
    });
    characterList.mockRejectedValue(err);
    retryStarterSeed.mockRejectedValue(err);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: true });

    expect(result.usingBundledSeed).toBe(true);
    expect(result.error).toBe(err);
    expect(result.characters.length).toBeGreaterThan(0);
    expect(result.characters[0]._bundled).toBe(true);
    expect(getStarterRoster).toHaveBeenCalled();
  });

  it("falls back to bundled starters when auth/seed fails so Select Character is never blank", async () => {
    characterList.mockResolvedValue([]);
    retryStarterSeed.mockRejectedValue(
      Object.assign(new Error("Store auth token not available"), {
        status: 401,
      }),
    );
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: true });

    expect(result.usingBundledSeed).toBe(true);
    expect(result.characters.length).toBeGreaterThan(0);
    expect(result.characters[0]._bundled).toBe(true);
    expect(result.error?.message).toMatch(/auth token/i);
  });

  it("falls back to bundled starters when the store returns an empty roster after retry", async () => {
    characterList.mockResolvedValue([]);
    retryStarterSeed.mockResolvedValue(0);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: true });

    expect(result.usingBundledSeed).toBe(true);
    expect(result.characters.map((c) => c.name)).toContain("Korra");
  });

  it("falls back when waitForStoreAuth fails even before listing", async () => {
    waitForStoreAuth.mockRejectedValue(
      new Error("Store auth token not available"),
    );
    characterList.mockResolvedValue([]);
    retryStarterSeed.mockRejectedValue(
      new Error("Store auth token not available"),
    );
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: true });

    expect(result.usingBundledSeed).toBe(true);
    expect(result.characters.length).toBeGreaterThan(0);
  });
});
