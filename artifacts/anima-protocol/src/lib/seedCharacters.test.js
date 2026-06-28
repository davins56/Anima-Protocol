import { describe, it, expect, beforeEach, vi } from "vitest";

<<<<<<< HEAD
// Seeding the starter roster is async and is triggered from a React effect that
// StrictMode double-invokes in dev. The module-level promise lock in
// seedCharactersIfNeeded() must guarantee the roster is seeded at most once per
// load even under concurrent calls. We back base44 with an in-memory store whose
// update() upserts by id (mirroring the real server PUT), and stub the photo
// lookup so seeding never hits the network.
vi.mock("@/api/base44Client", () => {
  const store = new Map();
  let updateCalls = 0;
  // Failure injection: the update() whose 1-based call index === failAtCall
  // throws before writing, simulating the store dropping out partway through a
  // seeding pass (so earlier rows in that pass are already written).
  let failAtCall = -1;
  const Character = {
    async list() {
      return [...store.values()].map((r) => ({ ...r }));
    },
    async update(id, data) {
      updateCalls += 1;
      if (updateCalls === failAtCall) {
        throw new Error("store unavailable");
      }
      const existing = store.get(id) || { id };
      const rec = { ...existing, ...data, id };
      store.set(id, rec);
      return { ...rec };
    },
  };
  const base44 = {
    entities: new Proxy({}, { get: () => Character }),
    __store: store,
    __stats: () => ({ updateCalls }),
    __failUpdateAt: (n) => {
      failAtCall = n;
    },
    __reset: () => {
      store.clear();
      updateCalls = 0;
      failAtCall = -1;
    },
  };
  return { base44, default: base44 };
});

// No network during seeding: every character resolves to "no photo found".
vi.mock("@/lib/characterPhoto", () => ({
  findCharacterPhoto: vi.fn().mockResolvedValue(null),
=======
const {
  waitForStoreAuth,
  characterList,
  characterUpdate,
  characterBulkUpsert,
  clearStoreCache,
  notifyStoreChanged,
} = vi.hoisted(() => ({
  waitForStoreAuth: vi.fn().mockResolvedValue("token"),
  characterList: vi.fn(),
  characterUpdate: vi.fn(),
  characterBulkUpsert: vi.fn(),
  clearStoreCache: vi.fn(),
  notifyStoreChanged: vi.fn(),
>>>>>>> ba87202e28205b931889038d30e8e7abed2ff7e5
}));

vi.mock("@/api/base44Client", () => ({
  waitForStoreAuth,
  clearStoreCache,
  notifyStoreChanged,
  base44: {
    entities: {
      Character: {
        list: characterList,
        update: characterUpdate,
        bulkUpsert: characterBulkUpsert,
      },
    },
  },
}));

vi.mock("@/lib/characterPhoto", () => ({
  findCharacterPhoto: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  characterList.mockReset();
  characterUpdate.mockReset().mockResolvedValue({});
  characterBulkUpsert.mockReset().mockResolvedValue({ count: 1, items: [] });
  clearStoreCache.mockReset();
  notifyStoreChanged.mockReset();
  waitForStoreAuth.mockReset().mockResolvedValue("token");
});

async function loadSeedModule() {
  return import("@/lib/seedCharacters");
}

describe("seedCharactersIfNeeded", () => {
  it("skips seeding when the full starter roster is already present", async () => {
    const { seedCharactersIfNeeded, getStarterRoster } = await loadSeedModule();
    characterList.mockResolvedValue(getStarterRoster());

    await seedCharactersIfNeeded();

    expect(waitForStoreAuth).toHaveBeenCalledTimes(1);
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("upserts the starter roster when the account has no characters", async () => {
    characterList.mockResolvedValue([]);
    const { seedCharactersIfNeeded } = await loadSeedModule();

    await seedCharactersIfNeeded();

<<<<<<< HEAD
  it("recovers a full roster when the first seed pass fails partway", async () => {
    // First pass writes 3 rows, then the 4th write fails (store drops out
    // mid-pass). doSeed() retries the whole upsert pass, which re-updates the
    // first 3 (idempotent) and creates the rest.
    base44.__failUpdateAt(4);

    await seedCharactersIfNeeded();

    const chars = await base44.entities.Character.list();
    // Every starter is present despite the mid-pass failure...
    const seeded = chars.filter((c) => c.id.startsWith("seed_"));
    expect(seeded.length).toBeGreaterThan(3);
    // ...and there are no duplicate rows (deterministic seed_ ids converge).
    const ids = seeded.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not seed when the account already has characters", async () => {
    await base44.entities.Character.update("existing_1", {
      id: "existing_1",
      name: "Pre-existing",
      avatar_url: "x",
=======
    expect(characterBulkUpsert).toHaveBeenCalledTimes(1);
    expect(characterBulkUpsert.mock.calls[0][0].length).toBeGreaterThan(20);
    expect(characterBulkUpsert.mock.calls[0][0][0]).toMatchObject({
      id: expect.stringMatching(/^seed_/),
      name: expect.any(String),
      universe: expect.any(String),
>>>>>>> ba87202e28205b931889038d30e8e7abed2ff7e5
    });
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("repairs only missing starters when the roster is partial", async () => {
    characterList.mockResolvedValue([
      { id: "seed_avatar-legend-of-korra-korra", name: "Korra" },
      { id: "user_custom_1", name: "My OC" },
    ]);
    const { seedCharactersIfNeeded, getStarterRoster } = await loadSeedModule();
    const expectedMissing =
      getStarterRoster().length -
      1; /* Korra already present */

    await seedCharactersIfNeeded();

    expect(characterBulkUpsert).toHaveBeenCalledTimes(1);
    const upserted = characterBulkUpsert.mock.calls[0][0];
    expect(upserted.length).toBe(expectedMissing);
    expect(
      upserted.every((c) => c.id !== "seed_avatar-legend-of-korra-korra"),
    ).toBe(true);
    expect(upserted.every((c) => c.id !== "user_custom_1")).toBe(true);
  });

  it("clears the per-load lock after a failed seed so a retry can run", async () => {
    characterList.mockResolvedValue([]);
    characterBulkUpsert.mockRejectedValueOnce(new Error("network down"));
    const { seedCharactersIfNeeded } = await loadSeedModule();

    await expect(seedCharactersIfNeeded()).rejects.toThrow("network down");
    characterBulkUpsert.mockResolvedValue({ count: 1, items: [] });
    await seedCharactersIfNeeded();

    expect(characterBulkUpsert.mock.calls.length).toBe(2);
  });

  it("falls back to per-row update when bulk-upsert is unavailable", async () => {
    characterList.mockResolvedValue([]);
    const bulkErr = new Error("Not Found");
    bulkErr.status = 404;
    characterBulkUpsert.mockRejectedValueOnce(bulkErr);
    const { seedCharactersIfNeeded } = await loadSeedModule();

    await seedCharactersIfNeeded();

    expect(characterUpdate.mock.calls.length).toBeGreaterThan(20);
  });
});

describe("repairStarterCharacters", () => {
  it("verifies the full roster after repair and notifies listeners", async () => {
    const { repairStarterCharacters, getStarterRoster } = await loadSeedModule();
    const roster = getStarterRoster();
    characterList
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(roster);
    characterBulkUpsert.mockResolvedValue({ count: roster.length, items: roster });

    const restored = await repairStarterCharacters();

    expect(restored).toBe(roster.length);
    expect(clearStoreCache).toHaveBeenCalled();
    expect(notifyStoreChanged).toHaveBeenCalled();
  });

  it("throws when starters are still missing after upsert", async () => {
    const { repairStarterCharacters } = await loadSeedModule();
    characterList.mockResolvedValue([]);
    characterBulkUpsert.mockResolvedValue({ count: 0, items: [] });

    await expect(repairStarterCharacters()).rejects.toThrow(/Only 0 of/);
  });
});
