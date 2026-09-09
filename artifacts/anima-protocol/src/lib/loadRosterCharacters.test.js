import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  characterList,
  characterFilter,
  animaList,
  notifyStoreChanged,
  awaitCompanionStoreAuth,
  retryStarterSeed,
  getStarterRoster,
  whenBootstrapReady,
} = vi.hoisted(() => ({
  characterList: vi.fn(),
  characterFilter: vi.fn(),
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
      Character: { list: characterList, filter: characterFilter },
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

function stubCharacterLists({ main = [], search = [] } = {}) {
  characterList.mockImplementation(async (_sort, _limit, opts) => {
    if (opts?.search?.name) {
      return typeof search === "function" ? search(opts.search.name) : search;
    }
    return typeof main === "function" ? main() : main;
  });
}

function stubAnimaLists({ main = [], search = [] } = {}) {
  animaList.mockImplementation(async (_sort, _limit, opts) => {
    if (opts?.search?.name) {
      return typeof search === "function" ? search(opts.search.name) : search;
    }
    return typeof main === "function" ? main() : main;
  });
}

async function loadModule() {
  vi.resetModules();
  return import("@/lib/loadRosterCharacters");
}

beforeEach(() => {
  characterList.mockReset();
  characterFilter.mockReset().mockResolvedValue([]);
  animaList.mockReset();
  stubAnimaLists({ main: [] });
  notifyStoreChanged.mockReset();
  awaitCompanionStoreAuth.mockReset().mockResolvedValue("token");
  retryStarterSeed.mockReset();
  getStarterRoster.mockClear();
  whenBootstrapReady.mockReset().mockResolvedValue(undefined);
});

describe("loadRosterCharacters", () => {
  it("returns characters after bootstrap without retrying when the roster is populated", async () => {
    stubCharacterLists({
      main: [{ id: "seed_avatar-legend-of-korra-korra", name: "Korra" }],
    });
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
    let mains = 0;
    stubCharacterLists({
      main: () => {
        mains += 1;
        if (mains === 1) return [];
        return [{ id: "seed_avatar-legend-of-korra-korra", name: "Korra" }];
      },
    });
    retryStarterSeed.mockResolvedValue(1);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: true });

    expect(retryStarterSeed).toHaveBeenCalledTimes(1);
    expect(result.characters.map((c) => c.name)).toContain("Korra");
    expect(result.usingBundledSeed).toBe(false);
  });

  it("does not treat an empty-token [] as a finished empty account", async () => {
    awaitCompanionStoreAuth.mockResolvedValue(null);
    stubCharacterLists({ main: [] });
    retryStarterSeed.mockResolvedValue(1);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: true });

    expect(retryStarterSeed).not.toHaveBeenCalled();
    expect(result.usingBundledSeed).toBe(true);
    expect(result.error?.message).toMatch(/auth token/i);
    expect(result.characters.length).toBeGreaterThan(0);
    expect(result.characters.every((c) => c._bundled)).toBe(true);
  });

  it("keeps bundled starters on store-sync refetches with retrySeed false", async () => {
    stubCharacterLists({ main: [] });
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
    stubCharacterLists({
      main: [{ id: "seed_marvel-spider-man", name: "Spider-Man" }],
    });
    stubAnimaLists({
      main: [{ id: "anima_1", name: "Serenity", archetype: "guardian" }],
    });
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

  it("clears usingBundledSeed when only Anima rows exist", async () => {
    stubCharacterLists({ main: [] });
    stubAnimaLists({
      main: [{ id: "anima_1", name: "Serenity", archetype: "guardian" }],
    });
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(result.usingBundledSeed).toBe(false);
    expect(result.fallbackKind).toBeNull();
    expect(result.characters.map((c) => c.name)).toContain("Serenity");
    expect(result.characters.some((c) => c._bundled)).toBe(true);
  });

  it("recovers Aelynd from a name search when she is missing from the newest list", async () => {
    stubCharacterLists({
      main: [{ id: "seed_1", name: "Korra", universe: "Avatar: Legend of Korra" }],
      search: (name) =>
        name === "aelynd"
          ? [{ id: "char_aelynd", name: "Aelynd", universe: "Original" }]
          : [],
    });
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(result.usingBundledSeed).toBe(false);
    expect(result.characters.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Aelynd", "Korra"]),
    );
  });

  it("returns Serenity from Anima.list even when Character.list never settles", async () => {
    stubCharacterLists({ main: () => new Promise(() => {}) });
    stubAnimaLists({
      main: [{ id: "anima_1", name: "Serenity", archetype: "guardian" }],
    });
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({
      retrySeed: false,
      listTimeoutMs: 25,
    });

    expect(result.usingBundledSeed).toBe(false);
    expect(result.characters.map((c) => c.name)).toContain("Serenity");
    expect(result.error?.code).toBe("timeout");
  });

  it("falls back to bundled starters when store DB is down", async () => {
    const err = Object.assign(new Error("Database unavailable"), {
      status: 503,
    });
    stubCharacterLists({ main: () => Promise.reject(err) });
    retryStarterSeed.mockRejectedValue(err);
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: true });

    expect(retryStarterSeed).not.toHaveBeenCalled();
    expect(result.usingBundledSeed).toBe(true);
    expect(result.error).toBe(err);
    expect(result.characters.length).toBeGreaterThan(0);
    expect(result.characters[0]._bundled).toBe(true);
    expect(getStarterRoster).toHaveBeenCalled();
  });

  it("falls back to bundled starters when auth/seed fails so Select Character is never blank", async () => {
    stubCharacterLists({ main: [] });
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
    stubCharacterLists({
      main: [
        {
          id: "char_custom",
          name: "Aelynd",
          universe: "Original",
          creation_method: "ai_prompt",
        },
      ],
    });
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
    let mains = 0;
    stubCharacterLists({
      main: () => {
        mains += 1;
        if (mains === 1) return Promise.reject(timeout);
        return [{ id: "char_store", name: "Aelynd", universe: "Original" }];
      },
    });
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(awaitCompanionStoreAuth).toHaveBeenCalledTimes(2);
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
    stubCharacterLists({ main: () => Promise.reject(timeout) });
    const { loadRosterCharacters } = await loadModule();

    const result = await loadRosterCharacters({ retrySeed: false });

    expect(result.usingBundledSeed).toBe(true);
    expect(result.fallbackKind).toBe("timeout");
    expect(result.characters.length).toBeGreaterThan(0);
    expect(result.error).toBe(timeout);
  });

  it("exposes getBundledStarterRoster for immediate modal paint", async () => {
    const { getBundledStarterRoster, hasAccountRosterRows } = await loadModule();
    const roster = getBundledStarterRoster();
    expect(roster.length).toBeGreaterThan(0);
    expect(roster.every((c) => c._bundled && c.id && c.name)).toBe(true);
    expect(hasAccountRosterRows(roster)).toBe(false);
    expect(
      hasAccountRosterRows([{ id: "anima_1", name: "Serenity" }]),
    ).toBe(true);
  });
});
