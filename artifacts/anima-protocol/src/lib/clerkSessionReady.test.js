import { describe, expect, it, vi } from "vitest";
import {
  isUsableClerkSessionToken,
  resolveSignedInUser,
  waitForClerkSessionToken,
} from "./clerkSessionReady";

describe("isUsableClerkSessionToken", () => {
  it("rejects missing, guest, and short tokens", () => {
    expect(isUsableClerkSessionToken(null)).toBe(false);
    expect(isUsableClerkSessionToken("")).toBe(false);
    expect(isUsableClerkSessionToken("local_user_seeker")).toBe(false);
    expect(isUsableClerkSessionToken("short")).toBe(false);
  });

  it("accepts a Clerk-sized JWT", () => {
    expect(
      isUsableClerkSessionToken(
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEifQ.sig",
      ),
    ).toBe(true);
  });
});

describe("resolveSignedInUser", () => {
  it("requires Clerk sign-in, user id, and a readable session token", () => {
    expect(
      resolveSignedInUser({
        clerkSignedIn: true,
        clerkUserId: "user_1",
        sessionTokenReady: false,
      }),
    ).toBe(false);
    expect(
      resolveSignedInUser({
        clerkSignedIn: true,
        clerkUserId: "user_1",
        sessionTokenReady: true,
      }),
    ).toBe(true);
    expect(
      resolveSignedInUser({
        clerkSignedIn: true,
        clerkUserId: "",
        sessionTokenReady: true,
      }),
    ).toBe(false);
  });
});

describe("waitForClerkSessionToken", () => {
  it("returns the first usable token and skips guest tokens", async () => {
    const getToken = vi
      .fn()
      .mockResolvedValueOnce("local_user_seeker")
      .mockResolvedValueOnce(
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEifQ.sig",
      );
    await expect(
      waitForClerkSessionToken(getToken, { timeoutMs: 1000, intervalMs: 1 }),
    ).resolves.toMatch(/^eyJ/);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("returns null when no session token appears", async () => {
    const getToken = vi.fn().mockResolvedValue(null);
    await expect(
      waitForClerkSessionToken(getToken, { timeoutMs: 30, intervalMs: 5 }),
    ).resolves.toBeNull();
  });
});
