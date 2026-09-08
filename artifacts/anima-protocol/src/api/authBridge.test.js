import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_TOKEN_TIMEOUT_MS } from "@/lib/storeTimeouts";
import {
  clearAuthTokenGetter,
  getToken,
  setAuthTokenGetter,
  waitForStoreAuth,
} from "./authBridge";

describe("authBridge getToken", () => {
  beforeEach(() => {
    clearAuthTokenGetter();
  });

  afterEach(() => {
    clearAuthTokenGetter();
    vi.useRealTimers();
  });

  it("returns null when no getter is registered", async () => {
    await expect(getToken()).resolves.toBeNull();
  });

  it("returns a string token from a sync getter without arming a timer", async () => {
    vi.useFakeTimers();
    setAuthTokenGetter(() => "tok_sync");
    await expect(getToken()).resolves.toBe("tok_sync");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a string token from an async getter", async () => {
    setAuthTokenGetter(async () => "tok_live");
    await expect(getToken()).resolves.toBe("tok_live");
  });

  it("unwraps one accidental extra function layer", async () => {
    setAuthTokenGetter(() => async () => "tok_unwrapped");
    await expect(getToken()).resolves.toBe("tok_unwrapped");
  });

  it("returns null when the token getter never settles", async () => {
    vi.useFakeTimers();
    setAuthTokenGetter(() => new Promise(() => {}));
    const pending = getToken();
    await vi.advanceTimersByTimeAsync(STORE_TOKEN_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });

  it("honors a shorter timeoutMs override", async () => {
    vi.useFakeTimers();
    setAuthTokenGetter(() => new Promise(() => {}));
    const pending = getToken({ timeoutMs: 250 });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBeNull();
  });

  it("does not pass timeoutMs through to the getter", async () => {
    const getter = vi.fn(async (options) => {
      expect(options).toEqual({ skipCache: true });
      return "tok_skip";
    });
    setAuthTokenGetter(getter);
    await expect(getToken({ skipCache: true, timeoutMs: 1000 })).resolves.toBe(
      "tok_skip",
    );
    expect(getter).toHaveBeenCalledWith({ skipCache: true });
  });

  it("waitForStoreAuth throws when getToken never settles", async () => {
    setAuthTokenGetter(() => new Promise(() => {}));
    await expect(waitForStoreAuth(80)).rejects.toThrow(
      "Store auth token not available",
    );
  });
});
