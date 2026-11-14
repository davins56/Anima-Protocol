import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  supported: true,
  enableProactivePush: vi.fn(),
}));
vi.mock("@/lib/pushNotifications", () => ({
  supportsPushNotifications: () => push.supported,
  enableProactivePush: push.enableProactivePush,
}));

import { useBotMessagePush } from "./useBotMessagePush";

beforeEach(() => {
  vi.clearAllMocks();
  push.supported = true;
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "default", requestPermission: vi.fn(async () => "granted") },
  });
});

describe("useBotMessagePush", () => {
  it("does nothing while the server has no bot messages", async () => {
    const { result } = renderHook(() => useBotMessagePush({ available: false }));
    expect(result.current.state).toBe("unavailable");
    await act(async () => {
      expect(await result.current.enable()).toBe(false);
    });
    expect(push.enableProactivePush).not.toHaveBeenCalled();
  });

  it("reuses the existing web push flow and reports granted", async () => {
    push.enableProactivePush.mockResolvedValue({});
    const { result } = renderHook(() => useBotMessagePush({ available: true }));
    expect(result.current.state).toBe("default");
    await act(async () => {
      expect(await result.current.enable()).toBe(true);
    });
    expect(push.enableProactivePush).toHaveBeenCalledWith({ requestPermission: true });
    expect(result.current.state).toBe("granted");
  });

  it("reports a denied permission", async () => {
    push.enableProactivePush.mockRejectedValue(Object.assign(new Error("Notifications are blocked."), { code: "permission_denied" }));
    const { result } = renderHook(() => useBotMessagePush({ available: true }));
    await act(async () => {
      await result.current.enable();
    });
    expect(result.current.state).toBe("denied");
    expect(result.current.error).toMatch(/blocked/);
  });

  it("reports unsupported browsers", () => {
    push.supported = false;
    const { result } = renderHook(() => useBotMessagePush({ available: true }));
    expect(result.current.state).toBe("unsupported");
  });
});
