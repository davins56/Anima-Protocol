import { describe, expect, it } from "vitest";
import { acquireChatSendLock, releaseChatSendLock } from "./chatSendLock";

describe("chat send lock", () => {
  it("rejects a second acquire while the first send is in flight", () => {
    const sendingRef = { current: false };
    const first = acquireChatSendLock(sendingRef, {
      hasSession: true,
      isLoading: false,
    });
    expect(first).toBeTruthy();
    expect(sendingRef.current).toBe(first);
    expect(
      acquireChatSendLock(sendingRef, { hasSession: true, isLoading: false }),
    ).toBe(false);
    expect(
      acquireChatSendLock(sendingRef, { hasSession: true, isLoading: true }),
    ).toBe(false);
    releaseChatSendLock(sendingRef, first);
    expect(sendingRef.current).toBe(false);
    const second = acquireChatSendLock(sendingRef, {
      hasSession: true,
      isLoading: false,
    });
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("does not unlock a newer send from an older persist cleanup", () => {
    const sendingRef = { current: false };
    const first = acquireChatSendLock(sendingRef, {
      hasSession: true,
      isLoading: false,
    });
    releaseChatSendLock(sendingRef, first);
    const second = acquireChatSendLock(sendingRef, {
      hasSession: true,
      isLoading: false,
    });
    releaseChatSendLock(sendingRef, first);
    expect(sendingRef.current).toBe(second);
    releaseChatSendLock(sendingRef, second);
    expect(sendingRef.current).toBe(false);
  });

  it("does not lock when there is no session", () => {
    const sendingRef = { current: false };
    expect(
      acquireChatSendLock(sendingRef, { hasSession: false, isLoading: false }),
    ).toBe(false);
    expect(sendingRef.current).toBe(false);
  });
});
