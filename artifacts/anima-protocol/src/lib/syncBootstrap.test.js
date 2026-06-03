import { describe, it, expect, beforeEach, vi } from "vitest";

// syncBootstrap orchestrates two one-time, race-sensitive steps that live on the
// CLIENT: (1) migrating the browser's pre-sync localStorage up to the signed-in
// account exactly once, ever, and (2) per-account starter seeding. We mock the
// two collaborators (the server bulkImport and the seeding routine) and assert
// the orchestration's guarantees directly.
const { bulkImport, seedCharactersIfNeeded, resetSeedLock } = vi.hoisted(() => ({
  bulkImport: vi.fn(),
  seedCharactersIfNeeded: vi.fn(),
  resetSeedLock: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({ bulkImport }));
vi.mock("@/lib/seedCharacters", () => ({ seedCharactersIfNeeded, resetSeedLock }));

const MIGRATION_KEY = "anima_server_migration_v1";

// Each test gets a fresh module instance (module-level promise/locks reset) and
// a clean storage, so one test's migration flag can't leak into the next.
async function loadBootstrap() {
  vi.resetModules();
  return (await import("@/lib/syncBootstrap")).bootstrapUserData;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  bulkImport.mockReset().mockResolvedValue({ imported: true, count: 1 });
  seedCharactersIfNeeded.mockReset().mockResolvedValue(undefined);
  resetSeedLock.mockReset();
});

describe("first sign-in migration", () => {
  it("migrates local entity data and profile exactly once, then marks it done", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );
    sessionStorage.setItem(
      "anima_auth_user",
      JSON.stringify({
        id: "old",
        email: "x@y.z",
        full_name: "Old",
        selected_mode: "story",
      }),
    );

    const bootstrapUserData = await loadBootstrap();
    await bootstrapUserData("userA");

    expect(bulkImport).toHaveBeenCalledTimes(1);
    const payload = bulkImport.mock.calls[0][0];
    expect(payload.entities.Character).toEqual([{ id: "c1", name: "Local Hero" }]);
    // Identity fields are stripped; only non-identity profile data migrates.
    expect(payload.profile).toEqual({ selected_mode: "story" });
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("does not import when there is no local data, but still seeds and marks done", async () => {
    const bootstrapUserData = await loadBootstrap();
    await bootstrapUserData("userA");

    expect(bulkImport).not.toHaveBeenCalled();
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("shares one run across concurrent bootstrap calls (no double import)", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );

    const bootstrapUserData = await loadBootstrap();
    // Two concurrent calls for the SAME account (mirrors React StrictMode's
    // double effect invoke) must resolve to the same in-flight promise.
    const p1 = bootstrapUserData("userA");
    const p2 = bootstrapUserData("userA");
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);

    expect(bulkImport).toHaveBeenCalledTimes(1);
  });

  it("never re-imports the browser's local data into a second account", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );

    const bootstrapUserData = await loadBootstrap();
    // Account A signs in first: local data migrates to A.
    await bootstrapUserData("userA");
    expect(bulkImport).toHaveBeenCalledTimes(1);

    // Account B then signs in on the same browser: the global migration flag
    // prevents the local data from being re-imported into B.
    await bootstrapUserData("userB");
    expect(bulkImport).toHaveBeenCalledTimes(1);
    // B still gets its own per-account seeding pass.
    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(2);
  });

  it("still seeds even if the migration import fails", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );
    bulkImport.mockRejectedValueOnce(new Error("network down"));

    const bootstrapUserData = await loadBootstrap();
    await bootstrapUserData("userA");

    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
    // A failed import is NOT marked done, so it will be retried next load.
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
  });

  it("does not mark migration done when the import resolves without confirming success", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );
    // A partial/failed import that still RESOLVES (no throw) but does not
    // confirm success must not flip the one-time flag, or the local data would
    // be silently abandoned with no retry.
    bulkImport.mockResolvedValueOnce({ imported: false });

    const bootstrapUserData = await loadBootstrap();
    await bootstrapUserData("userA");

    expect(bulkImport).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
    // Seeding still runs regardless of the migration outcome.
    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("retries the migration on the next sign-in after a failed import", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );
    // First attempt fails to confirm; the flag stays unset.
    bulkImport.mockResolvedValueOnce({ imported: false });

    const bootstrapUserData = await loadBootstrap();
    await bootstrapUserData("userA");
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();

    // Second sign-in (same browser): a fresh module instance retries the import,
    // this time succeeds, and only now marks the migration done.
    bulkImport.mockResolvedValueOnce({ imported: true, count: 1 });
    const bootstrapAgain = await loadBootstrap();
    await bootstrapAgain("userA");

    expect(bulkImport).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
  });
});
