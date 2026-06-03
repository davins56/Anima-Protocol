import { describe, it, expect, beforeEach, vi } from "vitest";

// Seeding the starter roster is async and is triggered from a React effect that
// StrictMode double-invokes in dev. The module-level promise lock in
// seedCharactersIfNeeded() must guarantee the roster is seeded at most once per
// load even under concurrent calls. We back base44 with an in-memory store whose
// update() upserts by id (mirroring the real server PUT), and stub the photo
// lookup so seeding never hits the network.
vi.mock("@/api/base44Client", () => {
  const store = new Map();
  let updateCalls = 0;
  const Character = {
    async list() {
      return [...store.values()].map((r) => ({ ...r }));
    },
    async update(id, data) {
      updateCalls += 1;
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
    __reset: () => {
      store.clear();
      updateCalls = 0;
    },
  };
  return { base44, default: base44 };
});

// No network during seeding: every character resolves to "no photo found".
vi.mock("@/lib/characterPhoto", () => ({
  findCharacterPhoto: vi.fn().mockResolvedValue(null),
}));

import { base44 } from "@/api/base44Client";
import { seedCharactersIfNeeded, resetSeedLock } from "@/lib/seedCharacters";

beforeEach(() => {
  localStorage.clear();
  base44.__reset();
  // Clear the per-load promise locks so each test re-evaluates seeding.
  resetSeedLock();
});

describe("starter roster seeding", () => {
  it("seeds a non-empty roster of unique characters into an empty account", async () => {
    await seedCharactersIfNeeded();

    const chars = await base44.entities.Character.list();
    expect(chars.length).toBeGreaterThan(0);
    // Deterministic ids => no duplicate rows.
    const ids = chars.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Every seeded character carries a stable seed_ id.
    expect(ids.every((id) => id.startsWith("seed_"))).toBe(true);
  });

  it("concurrent calls share one run and never double-seed (StrictMode safe)", async () => {
    // Two concurrent invocations (StrictMode double effect) must share the
    // single in-flight promise.
    const p1 = seedCharactersIfNeeded();
    const p2 = seedCharactersIfNeeded();
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);

    const chars = await base44.entities.Character.list();
    const rosterSize = chars.length;
    // Exactly one seeding pass ran: one update() per character, not two.
    expect(base44.__stats().updateCalls).toBe(rosterSize);
  });

  it("does not seed when the account already has characters", async () => {
    await base44.entities.Character.update("existing_1", {
      id: "existing_1",
      name: "Pre-existing",
      avatar_url: "x",
    });
    const before = base44.__stats().updateCalls;

    await seedCharactersIfNeeded();

    // The roster already had data, so doSeed() is a no-op (no new upserts).
    expect(base44.__stats().updateCalls).toBe(before);
    const chars = await base44.entities.Character.list();
    expect(chars).toHaveLength(1);
    expect(chars[0].name).toBe("Pre-existing");
  });
});
