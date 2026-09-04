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
import { ECHO_KEYS, starterOwnedIds } from "@/lib/echoKeys";

describe("useEchoLibrary", () => {
  beforeEach(() => {
    updateMeMock.mockReset();
    setUserMock.mockReset();
    updateMeMock.mockResolvedValue({ id: "user_1", settings: {} });
    authState.user = {
      id: "user_1",
      email: "seeker@example.com",
      settings: {
        echo_keys: { granted_full_library: false, owned_ids: ["pulse-base"] },
      },
    };
  });

  it("treats a starter handful as not yet the full Codex", () => {
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

  it("keeps a normal operator on the starter Vault and does not persist a full grant", async () => {
    const { result } = renderHook(() => useEchoLibrary());
    expect(result.current.library.granted_full_library).toBe(false);
    expect(result.current.library.owned_ids).toEqual(["pulse-base"]);
    expect(result.current.library.folder).toHaveLength(30);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updateMeMock).not.toHaveBeenCalled();
  });

  it("persists the full Codex after the steward loads Echo Keys", async () => {
    authState.user = {
      id: "user_davin",
      email: "davins56@gmail.com",
      settings: {
        echo_keys: { granted_full_library: false, owned_ids: starterOwnedIds() },
      },
    };
    const { result } = renderHook(() => useEchoLibrary());
    expect(result.current.library.owned_ids).toHaveLength(ECHO_KEYS.length);
    expect(result.current.library.granted_full_library).toBe(true);
    expect(result.current.library.folder).toHaveLength(30);

    await waitFor(() => expect(updateMeMock).toHaveBeenCalled());
    const payload = updateMeMock.mock.calls[0][0];
    expect(payload.settings.echo_keys.granted_full_library).toBe(true);
    expect(payload.settings.echo_keys.owned_ids).toHaveLength(ECHO_KEYS.length);
    expect(payload.settings.echo_keys.owned_ids).toEqual(
      expect.arrayContaining(["beth", "echo-empathy", "choir-compassion", "prime-echo-key", "wheel-crown"]),
    );
    expect(payload.settings.echo_keys.folder).toHaveLength(30);
  });
});
