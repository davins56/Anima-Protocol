import { describe, it, expect, beforeEach, vi } from "vitest";

// Seeding the starter roster is async and is triggered from a React effect that
// StrictMode double-invokes in dev. The module-level promise lock in
// seedCharactersIfNeeded() must guarantee the roster is seeded at most once per
// load even under concurrent calls. We back base44 with an in-memory store whose
// update() upserts by id (mirroring the real server PUT), and stub the photo
// lookup so seeding never hits the network.
const { notifyStoreChanged, clearStoreCache } = vi.hoisted(() => ({
  notifyStoreChanged: vi.fn(),
  clearStoreCache: vi.fn(),
}));

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
  return {
    base44,
    default: base44,
    notifyStoreChanged,
    clearStoreCache,
  };
});

// No network during seeding: every character resolves to "no photo found".
vi.mock("@/lib/characterPhoto", () => ({
  findCharacterPhoto: vi.fn().mockResolvedValue(null),
}));

import { base44 } from "@/api/base44Client";
import {
  seedCharactersIfNeeded,
  resetSeedLock,
  photoNeedsLookup,
} from "@/lib/seedCharacters";

beforeEach(() => {
  localStorage.clear();
  base44.__reset();
  notifyStoreChanged.mockClear();
  clearStoreCache.mockClear();
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
    expect(notifyStoreChanged).toHaveBeenCalledTimes(1);
    expect(clearStoreCache).toHaveBeenCalledTimes(1);
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

  it("still seeds the starter roster when the account only has custom characters", async () => {
    await base44.entities.Character.update("existing_1", {
      id: "existing_1",
      name: "Pre-existing",
      avatar_url: "x",
    });

    await seedCharactersIfNeeded();

    const chars = await base44.entities.Character.list();
    expect(chars.some((c) => c.id === "existing_1")).toBe(true);
    expect(chars.some((c) => c.id.startsWith("seed_"))).toBe(true);
    expect(chars.length).toBeGreaterThan(1);
  });

  it("does not re-seed when every starter character is already present", async () => {
    await seedCharactersIfNeeded();
    const before = base44.__stats().updateCalls;
    notifyStoreChanged.mockClear();
    clearStoreCache.mockClear();
    resetSeedLock();

    await seedCharactersIfNeeded();

    expect(base44.__stats().updateCalls).toBe(before);
    expect(notifyStoreChanged).not.toHaveBeenCalled();
  });
});

describe("photoNeedsLookup", () => {
  it("flags missing avatars as needing a lookup", () => {
    expect(photoNeedsLookup(undefined)).toBe(true);
    expect(photoNeedsLookup(null)).toBe(true);
    expect(photoNeedsLookup("")).toBe(true);
  });

  it("flags dead Fandom hotlinks (which 404 to a valid placeholder webp)", () => {
    expect(
      photoNeedsLookup(
        "https://static.wikia.nocookie.net/marvelcinematicuniverse/images/9/98/Tony_Stark_in_Endgame.png/revision/latest/scale-to-width-down/300",
      ),
    ).toBe(true);
  });

  it("accepts usable portrait URLs", () => {
    expect(
      photoNeedsLookup(
        "https://upload.wikimedia.org/wikipedia/en/f/f2/Robert_Downey_Jr._as_Tony_Stark.jpg",
      ),
    ).toBe(false);
    expect(photoNeedsLookup("/seed-avatars/mark-grayson.webp")).toBe(false);
  });
});
