import { describe, it, expect, beforeEach, vi } from "vitest";

// The restore flow is the most destructive write path in the app: "Replace
// Everything" wipes the account before inserting the backup. We back base44's
// restoreData() with an in-memory backend that mirrors the REAL server's
// merge/replace semantics (see api-server store /restore) so we can prove,
// without a server, that:
//   - merge keeps untouched records and upserts the backup over current data
//   - replace wipes-then-inserts (old gone, backup present)
//   - a failed restore rolls back transactionally (no half-written data)
//
// The in-memory db is a Map<entityName, Map<id, record>> plus a profile object.
// restoreData snapshots the db, mutates it, and on any error restores the
// snapshot and rethrows — exactly what the server's db.transaction guarantees.
vi.mock("@/api/base44Client", () => {
  const db = new Map();
  let profile = {};
  // A record carrying this marker makes the insert throw, so a test can simulate
  // a backup row the server can't write and assert the transaction rolls back.
  const POISON = "__poison__";

  const store = (name) => {
    if (!db.has(name)) db.set(name, new Map());
    return db.get(name);
  };

  const snapshot = () => ({
    entities: new Map(
      [...db.entries()].map(([name, recs]) => [name, new Map(recs)]),
    ),
    profile: { ...profile },
  });

  const restoreSnapshot = (snap) => {
    db.clear();
    for (const [name, recs] of snap.entities.entries()) {
      db.set(name, new Map(recs));
    }
    profile = { ...snap.profile };
  };

  const insertAll = (entities) => {
    let count = 0;
    for (const [name, recs] of Object.entries(entities || {})) {
      if (!Array.isArray(recs)) continue;
      for (const rec of recs) {
        if (rec && rec[POISON]) {
          throw new Error("could not write record");
        }
        store(name).set(rec.id, { ...rec });
        count += 1;
      }
    }
    return count;
  };

  const restoreData = vi.fn(async (payload, mode = "merge") => {
    const snap = snapshot();
    try {
      const entities = payload?.entities || {};
      if (mode === "replace") {
        // Wipe ALL of the user's entities, then insert the backup outright.
        db.clear();
        const count = insertAll(entities);
        profile = { ...(payload?.profile || {}) };
        return { count };
      }
      // merge: upsert backup records by id over current data; keep the rest.
      const count = insertAll(entities);
      profile = { ...profile, ...(payload?.profile || {}) };
      return { count };
    } catch (err) {
      // Transactional rollback: a failed restore must never half-write.
      restoreSnapshot(snap);
      throw err;
    }
  });

  // Test helpers (not part of the real client surface).
  const __seed = (entities, prof) => {
    db.clear();
    for (const [name, recs] of Object.entries(entities || {})) {
      const m = new Map();
      for (const rec of recs) m.set(rec.id, { ...rec });
      db.set(name, m);
    }
    profile = { ...(prof || {}) };
  };
  const __list = (name) => [...store(name).values()].map((r) => ({ ...r }));
  const __profile = () => ({ ...profile });
  const __reset = () => {
    db.clear();
    profile = {};
    restoreData.mockClear();
  };

  return {
    restoreData,
    __seed,
    __list,
    __profile,
    __reset,
    __POISON: POISON,
  };
});

import {
  restoreData,
  __seed,
  __list,
  __profile,
  __reset,
  __POISON,
} from "@/api/base44Client";
import { performRestoreFlow } from "@/lib/restoreHandlers";

// Build the deps bag performRestoreFlow expects, with vi.fn() spies for the
// state setters / refreshers so tests can assert what the page would do.
function makeDeps(pendingRestore) {
  return {
    pendingRestore,
    setRestoring: vi.fn(),
    setRestoreResult: vi.fn(),
    setPendingRestore: vi.fn(),
    setConfirmReplace: vi.fn(),
    loadStats: vi.fn().mockResolvedValue(undefined),
    loadUser: vi.fn().mockResolvedValue(undefined),
  };
}

// The most recent setRestoreResult({...}) argument — i.e. what the user sees.
function lastResult(deps) {
  const calls = deps.setRestoreResult.mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  __reset();
});

describe("performRestoreFlow", () => {
  it("does nothing when there is no staged backup", async () => {
    const deps = makeDeps(null);
    await performRestoreFlow("replace", deps);

    expect(restoreData).not.toHaveBeenCalled();
    expect(deps.setRestoring).not.toHaveBeenCalled();
    expect(deps.setRestoreResult).not.toHaveBeenCalled();
  });

  it("merge keeps existing rows and adds the backup rows", async () => {
    __seed(
      {
        Character: [
          { id: "c1", name: "Keep Me" },
          { id: "c2", name: "Old Name" },
        ],
      },
      { displayName: "Existing User", theme: "dark" },
    );

    const pendingRestore = {
      entities: {
        Character: [
          { id: "c2", name: "New Name" }, // upsert over existing
          { id: "c3", name: "From Backup" }, // brand new
        ],
      },
      profile: { displayName: "Restored User" },
    };
    const deps = makeDeps(pendingRestore);

    await performRestoreFlow("merge", deps);

    // Untouched record kept, mentioned record updated, new record added.
    const chars = __list("Character").sort((a, b) => a.id.localeCompare(b.id));
    expect(chars).toEqual([
      { id: "c1", name: "Keep Me" },
      { id: "c2", name: "New Name" },
      { id: "c3", name: "From Backup" },
    ]);
    // Profile: backup wins on overlap, existing-only keys preserved.
    expect(__profile()).toEqual({ displayName: "Restored User", theme: "dark" });

    // The page sees a success summary and the dialog is dismissed.
    expect(lastResult(deps)).toEqual({ ok: true, count: 2, mode: "merge" });
    expect(deps.setPendingRestore).toHaveBeenCalledWith(null);
    expect(deps.setConfirmReplace).toHaveBeenCalledWith(false);
    expect(deps.loadStats).toHaveBeenCalled();
    expect(deps.loadUser).toHaveBeenCalled();
    // Restoring flag toggled on then off.
    expect(deps.setRestoring).toHaveBeenNthCalledWith(1, true);
    expect(deps.setRestoring).toHaveBeenLastCalledWith(false);
  });

  it("replace wipes existing data then inserts only the backup", async () => {
    __seed(
      {
        Character: [
          { id: "c1", name: "Doomed" },
          { id: "c2", name: "Also Doomed" },
        ],
        Quest: [{ id: "q1", title: "Old Quest" }],
      },
      { displayName: "Existing User", theme: "dark" },
    );

    const pendingRestore = {
      entities: {
        Character: [{ id: "c9", name: "Only Survivor" }],
      },
      profile: { displayName: "Fresh User" },
    };
    const deps = makeDeps(pendingRestore);

    await performRestoreFlow("replace", deps);

    // Every pre-existing row is gone; only the backup rows remain.
    expect(__list("Character")).toEqual([{ id: "c9", name: "Only Survivor" }]);
    expect(__list("Quest")).toEqual([]);
    // Profile overwritten outright (no existing-only keys survive).
    expect(__profile()).toEqual({ displayName: "Fresh User" });

    expect(lastResult(deps)).toEqual({ ok: true, count: 1, mode: "replace" });
    expect(deps.setPendingRestore).toHaveBeenCalledWith(null);
  });

  it("a failed restore surfaces a friendly error and leaves data intact", async () => {
    __seed(
      {
        Character: [
          { id: "c1", name: "Survivor One" },
          { id: "c2", name: "Survivor Two" },
        ],
      },
      { displayName: "Existing User" },
    );

    // The backup's second record is un-writable; the restore must roll back.
    const pendingRestore = {
      entities: {
        Character: [
          { id: "c9", name: "Would-be New" },
          { id: "c10", name: "Bad Record", [__POISON]: true },
        ],
      },
      profile: { displayName: "Should Not Apply" },
    };
    const deps = makeDeps(pendingRestore);

    await performRestoreFlow("replace", deps);

    // Nothing half-written: original rows AND profile are exactly as before.
    const chars = __list("Character").sort((a, b) => a.id.localeCompare(b.id));
    expect(chars).toEqual([
      { id: "c1", name: "Survivor One" },
      { id: "c2", name: "Survivor Two" },
    ]);
    expect(__profile()).toEqual({ displayName: "Existing User" });

    // The user sees a friendly failure, not a success, and the staged backup is
    // NOT cleared so they can retry.
    const result = lastResult(deps);
    expect(result.ok).toBe(false);
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
    expect(deps.setPendingRestore).not.toHaveBeenCalled();
    // The in-progress flag is still cleared in the finally block.
    expect(deps.setRestoring).toHaveBeenLastCalledWith(false);
  });

  it("merge also rolls back on a mid-restore failure", async () => {
    __seed(
      { Character: [{ id: "c1", name: "Untouched" }] },
      { displayName: "Existing User" },
    );

    const pendingRestore = {
      entities: {
        Character: [{ id: "c2", name: "Bad", [__POISON]: true }],
      },
      profile: { displayName: "Should Not Apply" },
    };
    const deps = makeDeps(pendingRestore);

    await performRestoreFlow("merge", deps);

    expect(__list("Character")).toEqual([{ id: "c1", name: "Untouched" }]);
    expect(__profile()).toEqual({ displayName: "Existing User" });
    expect(lastResult(deps).ok).toBe(false);
  });
});
