import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { updateMeMock, setUserMock, authState } = vi.hoisted(() => ({
  updateMeMock: vi.fn(),
  setUserMock: vi.fn(),
  authState: {
    user: {
      id: "user_1",
      settings: {
        echo_keys: { granted_full_library: false, owned_ids: ["pulse-base"] },
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

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

import useEchoLibrary, { storedLibraryIsFull } from "./useEchoLibrary";
import { ECHO_KEYS } from "@/lib/echoKeys";

describe("useEchoLibrary", () => {
  beforeEach(() => {
    updateMeMock.mockReset();
    setUserMock.mockReset();
    updateMeMock.mockResolvedValue({ id: "user_1", settings: {} });
    authState.user = {
      id: "user_1",
      settings: {
        echo_keys: { granted_full_library: false, owned_ids: ["pulse-base"] },
      },
    };
  });

  it("treats a starter handful as not yet persisted", () => {
    expect(
      storedLibraryIsFull(
        { granted_full_library: false, owned_ids: ["pulse-base"] },
        ECHO_KEYS.length,
      ),
    ).toBe(false);
    expect(
      storedLibraryIsFull(
        { granted_full_library: true, owned_ids: ECHO_KEYS.map((k) => k.id) },
        ECHO_KEYS.length,
      ),
    ).toBe(true);
  });

  it("persists granted_full_library and every catalog id after load", async () => {
    const { result } = renderHook(() => useEchoLibrary());
    expect(result.current.library.owned_ids).toHaveLength(ECHO_KEYS.length);
    expect(result.current.library.granted_full_library).toBe(true);
    expect(result.current.library.folder).toHaveLength(30);

    await waitFor(() => expect(updateMeMock).toHaveBeenCalled());
    const payload = updateMeMock.mock.calls[0][0];
    expect(payload.settings.echo_keys.granted_full_library).toBe(true);
    expect(payload.settings.echo_keys.owned_ids).toHaveLength(ECHO_KEYS.length);
    expect(payload.settings.echo_keys.folder).toHaveLength(30);
  });
});
