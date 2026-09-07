import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { updateMeMock, setUserMock, authState } = vi.hoisted(() => ({
  updateMeMock: vi.fn(),
  setUserMock: vi.fn(),
  authState: {
    user: {
      id: "user_1",
      email: "seeker@example.com",
      settings: {
        energy_fragments: { granted_full_library: false, owned_ids: ["pulse-emitter"] },
      },
    },
  },
}));

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: {
      updateMe: (...args) => updateMeMock(...args),
    },
  },
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: authState.user, setUser: setUserMock }),
}));

import useEnergyFragmentLibrary from "./useEnergyFragmentLibrary";
import { ENERGY_FRAGMENTS, starterOwnedIds } from "@/lib/energyFragments";

describe("useEnergyFragmentLibrary", () => {
  beforeEach(() => {
    updateMeMock.mockReset();
    setUserMock.mockReset();
    updateMeMock.mockResolvedValue({ id: "user_1", settings: {} });
    authState.user = {
      id: "user_1",
      email: "seeker@example.com",
      settings: {
        energy_fragments: { granted_full_library: false, owned_ids: ["pulse-emitter"] },
      },
    };
  });

  it("keeps a normal operator on the starter Folder and does not persist a full grant", async () => {
    const { result } = renderHook(() => useEnergyFragmentLibrary());
    expect(result.current.library.granted_full_library).toBe(false);
    expect(result.current.library.owned_ids).toEqual(["pulse-emitter"]);
    expect(result.current.library.folder).toHaveLength(30);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updateMeMock).not.toHaveBeenCalled();
  });

  it("persists the full fragment library after the steward loads Energy Fragments", async () => {
    authState.user = {
      id: "user_davin",
      email: "davins56@gmail.com",
      settings: {
        energy_fragments: { granted_full_library: false, owned_ids: starterOwnedIds() },
      },
    };
    const { result } = renderHook(() => useEnergyFragmentLibrary());
    expect(result.current.library.owned_ids).toHaveLength(ENERGY_FRAGMENTS.length);
    expect(result.current.library.granted_full_library).toBe(true);
    expect(result.current.library.folder).toHaveLength(30);

    await waitFor(() => expect(updateMeMock).toHaveBeenCalled());
    const payload = updateMeMock.mock.calls[0][0];
    expect(payload.settings.energy_fragments.granted_full_library).toBe(true);
    expect(payload.settings.energy_fragments.owned_ids).toHaveLength(ENERGY_FRAGMENTS.length);
    expect(payload.settings.energy_fragments.folder).toHaveLength(30);
  });
});
