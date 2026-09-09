import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_TOKEN_TIMEOUT_MS } from "@/lib/storeTimeouts";
import {
  clearAuthTokenGetter,
  getToken,
  hasAuthTokenGetter,
  awaitCompanionStoreAuth,
  resolveStoreToken,
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
    expect(hasAuthTokenGetter()).toBe(false);
    await expect(getToken()).resolves.toBeNull();
  });

  it("reports when a token getter is registered", () => {
    expect(hasAuthTokenGetter()).toBe(false);
    setAuthTokenGetter(() => "tok");
    expect(hasAuthTokenGetter()).toBe(true);
    clearAuthTokenGetter();
    expect(hasAuthTokenGetter()).toBe(false);
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

  it("resolveStoreToken waits for a late Clerk mint instead of returning empty", async () => {
    let token = null;
    setAuthTokenGetter(() => token);
    const pending = resolveStoreToken(200);
    await new Promise((r) => setTimeout(r, 40));
    token = "late-jwt";
    await expect(pending).resolves.toBe("late-jwt");
  });

  it("resolveStoreToken returns null when no getter is registered", async () => {
    await expect(resolveStoreToken(20)).resolves.toBeNull();
  });

  it("awaitCompanionStoreAuth is fail-open when getToken never settles", async () => {
    setAuthTokenGetter(() => new Promise(() => {}));
    await expect(awaitCompanionStoreAuth(80)).resolves.toBeNull();
  });
});
