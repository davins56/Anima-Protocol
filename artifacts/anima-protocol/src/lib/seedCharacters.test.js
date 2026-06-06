import { describe, it, expect, beforeEach, vi } from "vitest";

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

    expect(characterBulkUpsert).toHaveBeenCalledTimes(1);
    expect(characterBulkUpsert.mock.calls[0][0].length).toBeGreaterThan(20);
    expect(characterBulkUpsert.mock.calls[0][0][0]).toMatchObject({
      id: expect.stringMatching(/^seed_/),
      name: expect.any(String),
      universe: expect.any(String),
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
