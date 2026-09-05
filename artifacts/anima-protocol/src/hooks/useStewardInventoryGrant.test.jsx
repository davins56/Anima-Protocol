import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ATTAINABLE_ITEMS } from "@/lib/inventory";

const { updateMeMock, createMock, filterMock, setUserMock, authState, rosterState } = vi.hoisted(() => ({
  updateMeMock: vi.fn(),
  createMock: vi.fn(),
  filterMock: vi.fn(),
  setUserMock: vi.fn(),
  authState: { user: { id: "user_1", email: "seeker@example.com", settings: {} } },
  rosterState: {
    rawCharacters: [{ id: "char-1", name: "Korra" }],
    characters: [{ id: "char-1", name: "Korra" }],
    animas: [],
    animaAsChars: [],
  },
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { updateMe: (...args) => updateMeMock(...args) },
    entities: {
      Inventory: {
        create: (...args) => createMock(...args),
        filter: (...args) => filterMock(...args),
      },
    },
  },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: authState.user, setUser: setUserMock }),
}));

vi.mock("@/lib/loadRosterCharacters", () => ({
  loadRosterCharacters: async () => rosterState,
}));

import useStewardInventoryGrant, { ensureStewardCatalogGrant } from "./useStewardInventoryGrant";

describe("ensureStewardCatalogGrant", () => {
  beforeEach(() => {
    createMock.mockReset();
    filterMock.mockReset();
    updateMeMock.mockReset();
    createMock.mockImplementation(async (payload) => ({ id: `inv-${payload.catalog_id}`, ...payload }));
    filterMock.mockResolvedValue([]);
    updateMeMock.mockResolvedValue({ id: "user_davin", settings: {} });
    rosterState.rawCharacters = [{ id: "char-1", name: "Korra" }];
    rosterState.characters = [{ id: "char-1", name: "Korra" }];
    rosterState.animas = [];
    rosterState.animaAsChars = [];
  });

  it("does not create catalog items for a non-steward", async () => {
    const result = await ensureStewardCatalogGrant({
      user: { id: "user_1", email: "seeker@example.com" },
      characterId: "char-1",
      createItem: createMock,
      listInventory: filterMock,
      listRoster: async () => rosterState,
    });
    expect(result.added).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates every missing catalog item for the steward", async () => {
    const created = [];
    const result = await ensureStewardCatalogGrant({
      user: { id: "user_davin", email: "davins56@gmail.com", settings: {} },
      characterId: "char-1",
      createItem: async (payload) => {
        created.push(payload);
        return payload;
      },
      listInventory: async () => [],
      listRoster: async () => rosterState,
      persistGrant: updateMeMock,
    });
    expect(result.added).toBe(ATTAINABLE_ITEMS.length);
    expect(created).toHaveLength(ATTAINABLE_ITEMS.length);
    expect(created.every((row) => row.character_id === "char-1")).toBe(true);
    expect(created.map((row) => row.catalog_id)).toEqual(ATTAINABLE_ITEMS.map((i) => i.id));
    expect(updateMeMock).toHaveBeenCalled();
    expect(updateMeMock.mock.calls[0][0].inventory.granted_full_catalog).toBe(true);
  });

  it("skips catalog ids the bag already holds", async () => {
    const result = await ensureStewardCatalogGrant({
      user: { id: "user_davin", email: "davins56@gmail.com", settings: {} },
      characterId: "char-1",
      createItem: createMock,
      listInventory: async () => ATTAINABLE_ITEMS.map((i) => ({ catalog_id: i.id, name: i.name })),
      listRoster: async () => rosterState,
    });
    expect(result.added).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("useStewardInventoryGrant", () => {
  beforeEach(() => {
    createMock.mockReset();
    filterMock.mockReset();
    updateMeMock.mockReset();
    setUserMock.mockReset();
    createMock.mockResolvedValue({});
    filterMock.mockResolvedValue([]);
    updateMeMock.mockResolvedValue({ id: "user_1", settings: {} });
    authState.user = { id: "user_1", email: "seeker@example.com", settings: {} };
  });

  it("is a no-op for a non-steward", async () => {
    const { result } = renderHook(() => useStewardInventoryGrant("char-1"));
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(createMock).not.toHaveBeenCalled();
    expect(result.current.added).toBe(0);
  });

  it("grants the catalog when the steward opens inventory", async () => {
    authState.user = { id: "user_davin", email: "davins56@gmail.com", settings: {} };
    const { result } = renderHook(() => useStewardInventoryGrant("char-1"));
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(createMock).toHaveBeenCalledTimes(ATTAINABLE_ITEMS.length);
    expect(result.current.added).toBe(ATTAINABLE_ITEMS.length);
  });
});
