import { describe, expect, it } from "vitest";
import {
  clerkDisplayNameFromUser,
  clerkEmailFromUser,
  clerkIdentityFromUser,
  shouldClearLocalSession,
} from "./clerkIdentity";

describe("clerkEmailFromUser", () => {
  it("prefers primaryEmailAddress", () => {
    expect(
      clerkEmailFromUser({
        primaryEmailAddress: { emailAddress: "ada@example.com" },
        emailAddresses: [{ emailAddress: "other@example.com" }],
      }),
    ).toBe("ada@example.com");
  });

  it("falls back to emailAddresses when primary is missing (GitHub hydrate)", () => {
    expect(
      clerkEmailFromUser({
        emailAddresses: [{ emailAddress: "gh@users.noreply.github.com" }],
      }),
    ).toBe("gh@users.noreply.github.com");
  });

  it("returns empty when Clerk has no email yet", () => {
    expect(clerkEmailFromUser({ id: "user_1" })).toBe("");
    expect(clerkEmailFromUser(null)).toBe("");
  });
});

describe("clerkDisplayNameFromUser", () => {
  it("never returns blank for a Clerk session", () => {
    expect(clerkDisplayNameFromUser({ id: "user_1" })).toBe("Seeker");
    expect(clerkDisplayNameFromUser({ username: "davins56" })).toBe("davins56");
    expect(clerkDisplayNameFromUser({ firstName: "Ada" })).toBe("Ada");
  });
});

describe("clerkIdentityFromUser", () => {
  it("maps a complete Clerk user", () => {
    expect(
      clerkIdentityFromUser({
        id: "user_abc",
        username: "davins56",
        fullName: "Dàvīn Smith",
        primaryEmailAddress: { emailAddress: "davins56@hotmail.com" },
        externalAccounts: [{ provider: "oauth_github", username: "davins56" }],
      }),
    ).toEqual({
      id: "user_abc",
      email: "davins56@hotmail.com",
      username: "davins56",
      full_name: "Dàvīn Smith",
      github: "davins56",
      externalAccounts: [{ provider: "oauth_github", username: "davins56" }],
    });
  });

  it("returns null without a Clerk user id", () => {
    expect(clerkIdentityFromUser(null)).toBeNull();
    expect(clerkIdentityFromUser({})).toBeNull();
  });
});

describe("shouldClearLocalSession", () => {
  it("does not clear while Clerk is signed in even if the user object is missing", () => {
    expect(
      shouldClearLocalSession({
        isSignedIn: true,
        hasLocalUser: false,
        pendingHandshake: false,
        clerkAuthReturn: false,
      }),
    ).toBe(false);
  });

  it("does not clear during handshake or just-returned Clerk auth", () => {
    expect(
      shouldClearLocalSession({
        isSignedIn: false,
        pendingHandshake: true,
      }),
    ).toBe(false);
    expect(
      shouldClearLocalSession({
        isSignedIn: false,
        clerkAuthReturn: true,
      }),
    ).toBe(false);
  });

  it("does not clear an explicit Instant Sandbox guest", () => {
    expect(
      shouldClearLocalSession({
        isSignedIn: false,
        hasLocalUser: true,
      }),
    ).toBe(false);
  });

  it("clears only when Clerk is loaded signed-out with no guest", () => {
    expect(
      shouldClearLocalSession({
        isSignedIn: false,
        hasLocalUser: false,
        pendingHandshake: false,
        clerkAuthReturn: false,
      }),
    ).toBe(true);
  });
});
