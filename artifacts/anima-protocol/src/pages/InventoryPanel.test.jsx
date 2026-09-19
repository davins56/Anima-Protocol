import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const loadRosterMock = vi.hoisted(() => vi.fn());
const inventoryFilterMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ConfirmDialog", () => ({
  useConfirm: () => async () => false,
}));

vi.mock("@/hooks/useStewardInventoryGrant", () => ({
  default: () => ({ granting: false, done: true, added: 0 }),
}));

vi.mock("@/lib/loadRosterCharacters", () => ({
  loadRosterCharacters: (...args) => loadRosterMock(...args),
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Inventory: {
        filter: (...args) => inventoryFilterMock(...args),
        update: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user_1" }, setUser: vi.fn() }),
}));

import InventoryPanel from "./InventoryPanel";

function renderPanel() {
  return render(
    <MemoryRouter>
      <InventoryPanel />
    </MemoryRouter>,
  );
}

describe("InventoryPanel empty roster", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    inventoryFilterMock.mockResolvedValue([]);
  });

  it("shows an empty state instead of spinning forever when there are no companions", async () => {
    loadRosterMock.mockResolvedValue({
      animaAsChars: [],
      rawCharacters: [],
    });

    renderPanel();

    expect(screen.getByText(/loading inventory/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(/no companions yet/i)).toBeTruthy();
    });
    expect(screen.queryByText(/loading inventory/i)).toBeNull();
    expect(screen.getByRole("link", { name: /create a companion/i })).toBeTruthy();
    expect(inventoryFilterMock).not.toHaveBeenCalled();
  });

  it("stops spinning when the roster fails to load", async () => {
    loadRosterMock.mockRejectedValue(new Error("store unavailable"));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/no companions yet/i)).toBeTruthy();
    });
    expect(screen.queryByText(/loading inventory/i)).toBeNull();
  });
});
