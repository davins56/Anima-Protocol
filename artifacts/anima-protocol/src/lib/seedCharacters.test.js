import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  waitForStoreAuth,
  characterList,
  characterUpdate,
  characterBulkUpsert,
  clearStoreCache,
  notifyStoreChanged,
  findCharacterPhoto,
} = vi.hoisted(() => ({
  waitForStoreAuth: vi.fn().mockResolvedValue("token"),
  characterList: vi.fn(),
  characterUpdate: vi.fn(),
  characterBulkUpsert: vi.fn(),
  clearStoreCache: vi.fn(),
  notifyStoreChanged: vi.fn(),
  findCharacterPhoto: vi.fn(),
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
  findCharacterPhoto,
}));

beforeEach(() => {
  vi.resetModules();
  characterList.mockReset();
  characterUpdate.mockReset().mockResolvedValue({});
  characterBulkUpsert.mockReset().mockResolvedValue({ count: 1, items: [] });
  clearStoreCache.mockReset();
  notifyStoreChanged.mockReset();
  waitForStoreAuth.mockReset().mockResolvedValue("token");
  findCharacterPhoto.mockReset().mockResolvedValue(null);
});

async function loadSeedModule() {
  return import("@/lib/seedCharacters");
}

<<<<<<< HEAD
=======
describe("getStarterRoster", () => {
  it("returns a non-empty bundled roster the Characters page can show offline", async () => {
    const { getStarterRoster } = await loadSeedModule();
    const roster = getStarterRoster();
    expect(roster.length).toBeGreaterThan(20);
    expect(roster.every((c) => c.id?.startsWith("seed_") && c.name && c.universe)).toBe(
      true,
    );
  });
});

>>>>>>> origin/main
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

    const upserted = characterBulkUpsert.mock.calls.flatMap((c) => c[0]);
    expect(upserted.length).toBeGreaterThan(20);
    expect(upserted[0]).toMatchObject({
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

    const upserted = characterBulkUpsert.mock.calls.flatMap((c) => c[0]);
    expect(upserted.length).toBe(expectedMissing);
    expect(
      upserted.every((c) => c.id !== "seed_avatar-legend-of-korra-korra"),
    ).toBe(true);
    expect(upserted.every((c) => c.id !== "user_custom_1")).toBe(true);
  });

  it("clears the per-load lock after a failed seed so a retry can run", async () => {
    characterList.mockResolvedValue([]);
    waitForStoreAuth.mockRejectedValue(new Error("auth not ready"));
    const { seedCharactersIfNeeded } = await loadSeedModule();

    await expect(seedCharactersIfNeeded()).rejects.toThrow("auth not ready");

    waitForStoreAuth.mockReset().mockResolvedValue("token");
    characterBulkUpsert.mockResolvedValue({ count: 1, items: [] });
    await seedCharactersIfNeeded();
    expect(characterBulkUpsert).toHaveBeenCalled();
  }, 10000);

  it("upserts the starter roster in batches when many characters are missing", async () => {
    characterList.mockResolvedValue([]);
    const { seedCharactersIfNeeded, getStarterRoster } = await loadSeedModule();
    const roster = getStarterRoster();

    await seedCharactersIfNeeded();

    expect(characterBulkUpsert.mock.calls.length).toBeGreaterThan(1);
    const upserted = characterBulkUpsert.mock.calls.flatMap((c) => c[0]);
    expect(upserted.length).toBe(roster.length);
  });

  it("falls back to per-row update when bulk-upsert is unavailable", async () => {
    characterList.mockResolvedValue([]);
    const bulkErr = new Error("Not Found");
    bulkErr.status = 404;
    characterBulkUpsert.mockRejectedValue(bulkErr);
    const { seedCharactersIfNeeded, getStarterRoster } = await loadSeedModule();

    await seedCharactersIfNeeded();

    expect(characterUpdate.mock.calls.length).toBe(getStarterRoster().length);
  });

  it("resolves after seeding without waiting for photo backfill", async () => {
    characterList
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "seed_test-hero", name: "Test Hero", avatar_url: "" },
      ]);
    findCharacterPhoto.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(null), 500)),
    );
    const { seedCharactersIfNeeded } = await loadSeedModule();

    const started = Date.now();
    await seedCharactersIfNeeded();
    const elapsed = Date.now() - started;

    expect(characterBulkUpsert).toHaveBeenCalled();
    expect(elapsed).toBeLessThan(500);
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
