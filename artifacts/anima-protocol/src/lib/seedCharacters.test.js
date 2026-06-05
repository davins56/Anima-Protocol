import { describe, it, expect, beforeEach, vi } from "vitest";

const { waitForStoreAuth, characterList, characterUpdate } = vi.hoisted(() => ({
  waitForStoreAuth: vi.fn().mockResolvedValue("token"),
  characterList: vi.fn(),
  characterUpdate: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  waitForStoreAuth,
  base44: {
    entities: {
      Character: {
        list: characterList,
        update: characterUpdate,
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
  waitForStoreAuth.mockReset().mockResolvedValue("token");
});

async function loadSeedModule() {
  return import("@/lib/seedCharacters");
}

describe("seedCharactersIfNeeded", () => {
  it("waits for auth before checking the roster", async () => {
    characterList.mockResolvedValue([{ id: "existing", name: "Korra" }]);
    const { seedCharactersIfNeeded } = await loadSeedModule();

    await seedCharactersIfNeeded();

    expect(waitForStoreAuth).toHaveBeenCalledTimes(1);
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("upserts the starter roster when the account has no characters", async () => {
    characterList.mockResolvedValue([]);
    const { seedCharactersIfNeeded } = await loadSeedModule();

    await seedCharactersIfNeeded();

    expect(characterUpdate.mock.calls.length).toBeGreaterThan(20);
    expect(characterUpdate.mock.calls[0][0]).toMatch(/^seed_/);
    expect(characterUpdate.mock.calls[0][1]).toMatchObject({
      id: expect.stringMatching(/^seed_/),
      name: expect.any(String),
      universe: expect.any(String),
    });
  });

  it("clears the per-load lock after a failed seed so a retry can run", async () => {
    characterList.mockResolvedValue([]);
    characterUpdate.mockRejectedValueOnce(new Error("network down"));
    const { seedCharactersIfNeeded } = await loadSeedModule();

    await expect(seedCharactersIfNeeded()).rejects.toThrow("network down");
    characterUpdate.mockResolvedValue({});
    await seedCharactersIfNeeded();

    expect(characterUpdate.mock.calls.length).toBeGreaterThan(20);
  });
});
