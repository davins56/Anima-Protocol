import { cleanup, renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = { user: { id: "user_clerk123" } };

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => authState,
}));

import { useTalkSectionCollapse } from "./useTalkSectionCollapse";

beforeEach(() => {
  localStorage.clear();
  authState.user = { id: "user_clerk123" };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useTalkSectionCollapse", () => {
  it("defaults to expanded and persists a toggle under the Clerk user key", () => {
    const { result } = renderHook(() => useTalkSectionCollapse("header"));
    expect(result.current.collapsed).toBe(false);
    expect(result.current.userId).toBe("user_clerk123");

    act(() => {
      result.current.toggle();
    });
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem("anima:talk:collapse:user_clerk123:header")).toBe("1");

    act(() => {
      result.current.toggle();
    });
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem("anima:talk:collapse:user_clerk123:header")).toBe("0");
  });

  it("restores a previously saved collapsed state on mount", () => {
    localStorage.setItem("anima:talk:collapse:user_clerk123:resonance", "1");
    const { result } = renderHook(() => useTalkSectionCollapse("resonance"));
    expect(result.current.collapsed).toBe(true);
  });

  it("falls back to the anon key when no user id is present", () => {
    authState.user = null;
    const { result } = renderHook(() => useTalkSectionCollapse("header"));
    expect(result.current.userId).toBe("anon");
    act(() => {
      result.current.toggle();
    });
    expect(localStorage.getItem("anima:talk:collapse:anon:header")).toBe("1");
  });
});
