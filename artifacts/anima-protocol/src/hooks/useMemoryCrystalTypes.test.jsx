import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MEMORY_CRYSTAL_TYPE_IDS } from "@/lib/memoryCrystals";

const { updateMeMock, setUserMock, authState } = vi.hoisted(() => ({
  updateMeMock: vi.fn(),
  setUserMock: vi.fn(),
  authState: {
    user: { id: "user_1", email: "seeker@example.com", settings: {} },
  },
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: { updateMe: (...args) => updateMeMock(...args) },
  },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: authState.user, setUser: setUserMock }),
}));

import useMemoryCrystalTypes from "./useMemoryCrystalTypes";

describe("useMemoryCrystalTypes", () => {
  beforeEach(() => {
    updateMeMock.mockReset();
    setUserMock.mockReset();
    updateMeMock.mockResolvedValue({ id: "user_1", settings: {} });
    authState.user = { id: "user_1", email: "seeker@example.com", settings: {} };
  });

  it("does not persist type unlocks for a non-steward", async () => {
    const { result } = renderHook(() => useMemoryCrystalTypes());
    expect(result.current.granted_all_types).toBe(false);
    expect(result.current.unlocked_types).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updateMeMock).not.toHaveBeenCalled();
  });

  it("persists every milestone type for the steward without minting crystals", async () => {
    authState.user = {
      id: "user_davin",
      email: "davins56@gmail.com",
      settings: { memory_crystals: { granted_all_types: false, unlocked_types: [] } },
    };
    const { result } = renderHook(() => useMemoryCrystalTypes());
    expect(result.current.granted_all_types).toBe(true);
    expect(result.current.unlocked_types).toEqual(MEMORY_CRYSTAL_TYPE_IDS);
    await waitFor(() => expect(updateMeMock).toHaveBeenCalled());
    const payload = updateMeMock.mock.calls[0][0];
    expect(payload.settings.memory_crystals.granted_all_types).toBe(true);
    expect(payload.settings.memory_crystals.unlocked_types).toEqual(MEMORY_CRYSTAL_TYPE_IDS);
  });
});
