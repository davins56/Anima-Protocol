import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  characterList,
  animaList,
  notifyStoreChanged,
  awaitCompanionStoreAuth,
  retryStarterSeed,
  getStarterRoster,
  whenBootstrapReady,
} = vi.hoisted(() => ({
  characterList: vi.fn(),
  animaList: vi.fn(),
  notifyStoreChanged: vi.fn(),
  awaitCompanionStoreAuth: vi.fn().mockResolvedValue("token"),
  retryStarterSeed: vi.fn(),
  getStarterRoster: vi.fn(() => [
    {
      id: "seed_avatar-legend-of-korra-korra",
      name: "Korra",
      universe: "Avatar: Legend of Korra",
    },
    {
      id: "seed_marvel-spider-man",
      name: "Spider-Man",
      universe: "Marvel",
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
}));

vi.mock("@/lib/listPersonalAnimas", () => ({
  awaitCompanionStoreAuth,
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
  awaitCompanionStoreAuth.mockReset().mockResolvedValue("token");
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
    expect(awaitCompanionStoreAuth).toHaveBeenCalled();
    expect(retryStarterSeed).not.toHaveBeenCalled();
    expect(result.characters.map((c) => c.name)).toContain("Korra");
    expect(result.usingBundledSeed).toBe(false);
    expect(result.characters.length).toBeGreaterThan(1);
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
    expect(result.characters.map((c) => c.name)).toContain("Korra");
    expect(result.usingBundledSeed).toBe(false);
  });

  it("keeps bundled starters on store-sync refetches with retrySeed false", async () => {
    // This is the race that left Select Character on NO RESULTS FOUND:
    // initial load showed bundled starters, then useStoreSync reloaded with
    // retrySeed:false and wiped them because the store was still empty.
    characterList.mockResolvedValue([]);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({
      retrySeed: false,
      allowBundledFallback: true,
    });

    expect(retryStarterSeed).not.toHaveBeenCalled();
    expect(result.usingBundledSeed).toBe(true);
    expect(result.characters.length).toBeGreaterThan(0);
    expect(result.characters.every((c) => c._bundled)).toBe(true);
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

    expect(result.characters[0]).toMatchObject({
      name: "Serenity",
      _isAnima: true,
      universe: "Anima",
    });
    expect(result.characters.map((c) => c.name)).toContain("Spider-Man");
    expect(result.characters.length).toBeGreaterThan(2);
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

  it("keeps custom store rows and fills missing bundled starters", async () => {
    characterList.mockResolvedValue([
      { id: "char_custom", name: "Aelynd", universe: "Original", creation_method: "ai_prompt" },
    ]);
    const { loadRosterCharacters, mergeRosterWithBundled, getBundledStarterRoster } =
      await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(result.usingBundledSeed).toBe(false);
    expect(result.characters.map((c) => c.id)).toContain("char_custom");
    expect(result.characters.some((c) => c._bundled && c.name === "Korra")).toBe(
      true,
    );

    const merged = mergeRosterWithBundled(
      [{ id: "seed_avatar-legend-of-korra-korra", name: "Korra", universe: "Avatar: Legend of Korra" }],
      getBundledStarterRoster(),
    );
    expect(merged.filter((c) => c.name === "Korra")).toHaveLength(1);
  });

  it("retries Character.list after auth wait when the first list times out", async () => {
    const timeout = Object.assign(
      new Error(
        "The server took too long to respond. Check your connection or try again in a moment.",
      ),
      { code: "timeout" },
    );
    characterList
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce([
        { id: "char_store", name: "Aelynd", universe: "Original" },
      ]);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(awaitCompanionStoreAuth).toHaveBeenCalledTimes(2);
    expect(characterList).toHaveBeenCalledTimes(2);
    expect(result.usingBundledSeed).toBe(false);
    expect(result.fallbackKind).toBeNull();
    expect(result.characters.map((c) => c.id)).toContain("char_store");
  });

  it("keeps bundled fallback after a second timeout without labeling it the success path", async () => {
    const timeout = Object.assign(
      new Error(
        "The server took too long to respond. Check your connection or try again in a moment.",
      ),
      { code: "timeout" },
    );
    characterList.mockRejectedValue(timeout);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(result.usingBundledSeed).toBe(true);
    expect(result.fallbackKind).toBe("timeout");
    expect(result.characters.length).toBeGreaterThan(0);
    expect(result.error).toBe(timeout);
  });

  it("exposes getBundledStarterRoster for immediate modal paint", async () => {
    const { getBundledStarterRoster } = await loadModule();
    const roster = getBundledStarterRoster();
    expect(roster.length).toBeGreaterThan(0);
    expect(roster.every((c) => c._bundled && c.id && c.name)).toBe(true);
  });
});
