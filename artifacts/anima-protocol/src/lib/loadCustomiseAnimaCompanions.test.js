import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  listAnima: vi.fn(),
  listCharacter: vi.fn(),
  whenBootstrapReady: vi.fn(),
  waitForStoreAuth: vi.fn(),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { me: mocks.me },
    entities: {
      Anima: { list: mocks.listAnima },
      Character: {
        list: mocks.listCharacter,
        filter: (...args) => mocks.listCharacter(...args),
      },
    },
  },
  waitForStoreAuth: mocks.waitForStoreAuth,
}));

vi.mock("@/lib/syncBootstrap", () => ({
  whenBootstrapReady: mocks.whenBootstrapReady,
}));

import { loadCustomiseAnimaCompanions } from "./loadCustomiseAnimaCompanions";

describe("loadCustomiseAnimaCompanions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.me.mockResolvedValue({ email: "operator@example.com" });
    mocks.whenBootstrapReady.mockResolvedValue(undefined);
    mocks.waitForStoreAuth.mockResolvedValue("token");
    mocks.listAnima.mockResolvedValue([]);
    mocks.listCharacter.mockResolvedValue([]);
  });

  it("returns companions after a Clerk token wait timeout", async () => {
    mocks.waitForStoreAuth.mockRejectedValue(
      new Error("Store auth token not available"),
    );
    mocks.listAnima.mockResolvedValue([
      { id: "anima-1", name: "Serenity", assigned_user: "operator@example.com" },
    ]);

    const result = await loadCustomiseAnimaCompanions();
    expect(result.kind).toBe("");
    expect(result.rows.map((row) => row.name)).toEqual(["Serenity"]);
  });

  it("classifies empty+no-token as unsigned instead of an empty roster", async () => {
    mocks.waitForStoreAuth.mockRejectedValue(
      new Error("Store auth token not available"),
    );

    const result = await loadCustomiseAnimaCompanions();
    expect(result.kind).toBe("unsigned");
    expect(result.rows).toEqual([]);
    expect(result.message).toMatch(/Store auth token not available/);
  });

  it("includes Aelynd from Character when she is not an Anima row", async () => {
    mocks.listAnima.mockResolvedValue([
      { id: "anima-1", name: "Serenity", created_date: "2026-01-01T00:00:00.000Z" },
    ]);
    mocks.listCharacter.mockResolvedValue([
      { id: "char-aelynd", name: "Aelynd", created_date: "2026-03-01T00:00:00.000Z" },
    ]);

    const result = await loadCustomiseAnimaCompanions();
    expect(result.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(["Serenity", "Aelynd"]),
    );
  });
});
