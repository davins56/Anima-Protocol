import { describe, it, expect, beforeEach, vi } from "vitest";

// syncBootstrap orchestrates two one-time, race-sensitive steps that live on the
// CLIENT: (1) migrating the browser's pre-sync localStorage up to the signed-in
// account exactly once, ever, and (2) per-account starter seeding. We mock the
// two collaborators (the server bulkImport and the seeding routine) and assert
// the orchestration's guarantees directly.
const {
  bulkImport,
  restoreData,
  notifyStoreChanged,
  seedCharactersIfNeeded,
  resetSeedLock,
} = vi.hoisted(() => ({
  bulkImport: vi.fn(),
  restoreData: vi.fn(),
  notifyStoreChanged: vi.fn(),
  seedCharactersIfNeeded: vi.fn(),
  resetSeedLock: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  bulkImport,
  restoreData,
  notifyStoreChanged,
}));
vi.mock("@/lib/seedCharacters", () => ({ seedCharactersIfNeeded, resetSeedLock }));

const MIGRATION_KEY = "anima_server_migration_v1";

// Each test gets a fresh module instance (module-level promise/locks reset) and
// a clean storage, so one test's migration flag can't leak into the next.
async function loadBootstrap() {
  vi.resetModules();
  return (await import("@/lib/syncBootstrap")).bootstrapUserData;
}

// Like loadBootstrap, but returns the whole fresh module so a test can drive the
// merge/dismiss exports against the same module-level pending-data state.
async function loadBootstrapModule() {
  vi.resetModules();
  return import("@/lib/syncBootstrap");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  bulkImport.mockReset().mockResolvedValue({ imported: true, count: 1 });
  restoreData.mockReset().mockResolvedValue({ restored: true, mode: "merge", count: 1 });
  notifyStoreChanged.mockReset();
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
    const outcome = await bootstrapUserData("userA");

    expect(bulkImport).toHaveBeenCalledTimes(1);
    const payload = bulkImport.mock.calls[0][0];
    expect(payload.entities.Character).toEqual([{ id: "c1", name: "Local Hero" }]);
    // Identity fields are stripped; only non-identity profile data migrates.
    expect(payload.profile).toEqual({ selected_mode: "story" });
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
    // A confirmed import reports "migrated" so the UI can clear any notice.
    expect(outcome).toBe("migrated");
  });

  it("does not import when there is no local data, but still seeds and marks done", async () => {
    const bootstrapUserData = await loadBootstrap();
    const outcome = await bootstrapUserData("userA");

    expect(bulkImport).not.toHaveBeenCalled();
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
    // Nothing to migrate reports "skipped" so the UI shows no notice.
    expect(outcome).toBe("skipped");
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
    const outcome = await bootstrapUserData("userA");

    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
    // A failed import is NOT marked done, so it will be retried next load.
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
    // A throwing import reports "failed" so the UI can warn the user.
    expect(outcome).toBe("failed");
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
    const outcome = await bootstrapUserData("userA");

    expect(bulkImport).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
    // Seeding still runs regardless of the migration outcome.
    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
    // An unconfirmed import reports "failed" so the UI can warn the user.
    expect(outcome).toBe("failed");
  });

  it("offers a merge when the account is non-empty but this device has leftover data", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );
    // A returning user: the account already has server data, so the one-time
    // import (empty-accounts only) no-ops. But this browser still holds local
    // data created offline. Rather than silently abandoning it, bootstrap reports
    // "local_data_available" so the UI can offer an optional, non-destructive
    // merge — and it does NOT set the flag yet (the user hasn't decided).
    bulkImport.mockResolvedValueOnce({
      imported: false,
      reason: "account_not_empty",
    });

    const bootstrapUserData = await loadBootstrap();
    const outcome = await bootstrapUserData("userA");

    expect(bulkImport).toHaveBeenCalledTimes(1);
    expect(outcome).toBe("local_data_available");
    // The decision is still pending, so the migration flag stays unset and no
    // merge has happened yet.
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
    expect(restoreData).not.toHaveBeenCalled();
    expect(seedCharactersIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("treats a non-empty account with no entity data (profile only) as done", async () => {
    // Only a settings blob, no meaningful entity records. There's nothing worth
    // prompting the user to merge, so behave as before: mark done and skip.
    sessionStorage.setItem(
      "anima_auth_user",
      JSON.stringify({ id: "old", email: "x@y.z", selected_mode: "story" }),
    );
    bulkImport.mockResolvedValueOnce({
      imported: false,
      reason: "account_not_empty",
    });

    const bootstrapUserData = await loadBootstrap();
    const outcome = await bootstrapUserData("userA");

    expect(outcome).toBe("skipped");
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    expect(restoreData).not.toHaveBeenCalled();
  });

  it("accepting the merge routes leftover local data through a merge restore and marks done", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );
    sessionStorage.setItem(
      "anima_auth_user",
      JSON.stringify({ id: "old", email: "x@y.z", selected_mode: "story" }),
    );
    bulkImport.mockResolvedValueOnce({
      imported: false,
      reason: "account_not_empty",
    });

    const mod = await loadBootstrapModule();
    const outcome = await mod.bootstrapUserData("userA");
    expect(outcome).toBe("local_data_available");
    expect(mod.hasPendingLocalMerge()).toBe(true);

    const result = await mod.mergeLeftoverLocalData();

    // The merge is a non-destructive "merge" restore over the existing account.
    expect(restoreData).toHaveBeenCalledTimes(1);
    const [payload, mode] = restoreData.mock.calls[0];
    expect(mode).toBe("merge");
    expect(payload.entities.Character).toEqual([{ id: "c1", name: "Local Hero" }]);
    expect(payload.profile).toEqual({ selected_mode: "story" });
    expect(result).toEqual({ restored: true, mode: "merge", count: 1 });
    // Now that the data is on the account, mark done so we stop offering.
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    expect(mod.hasPendingLocalMerge()).toBe(false);
    // The merged records must surface immediately: fire the store-changed
    // signal so any mounted lists (characters, stories, chat) refetch live
    // without a manual page refresh.
    expect(notifyStoreChanged).toHaveBeenCalledTimes(1);
  });

  it("declining the merge marks done without touching the account", async () => {
    localStorage.setItem(
      "anima_entity_Character",
      JSON.stringify([{ id: "c1", name: "Local Hero" }]),
    );
    bulkImport.mockResolvedValueOnce({
      imported: false,
      reason: "account_not_empty",
    });

    const mod = await loadBootstrapModule();
    await mod.bootstrapUserData("userA");
    expect(mod.hasPendingLocalMerge()).toBe(true);

    mod.dismissLeftoverLocalData();

    // Declining leaves the account untouched but stops re-prompting on next load.
    expect(restoreData).not.toHaveBeenCalled();
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");
    expect(mod.hasPendingLocalMerge()).toBe(false);
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
