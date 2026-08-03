import { describe, expect, it } from "vitest";

import { assertValidClerkE2EEnv } from "./clerkE2EEnv";

describe("assertValidClerkE2EEnv", () => {
  it("accepts valid Clerk test keys", () => {
    expect(() =>
      assertValidClerkE2EEnv({
        CLERK_SECRET_KEY: "sk_test_abcdefghijklmnopqrstuvwxyz",
        CLERK_PUBLISHABLE_KEY: "pk_test_abcdefghijklmnopqrstuvwxyz",
      }),
    ).not.toThrow();
  });

  it("reports missing Clerk keys", () => {
    expect(() => assertValidClerkE2EEnv({})).toThrow(
      /CLERK_SECRET_KEY is missing; CLERK_PUBLISHABLE_KEY is missing/,
    );
  });

  it("reports redacted non-ASCII secret values before Clerk setup runs", () => {
    expect(() =>
      assertValidClerkE2EEnv({
        CLERK_SECRET_KEY: "••••••••",
        CLERK_PUBLISHABLE_KEY: "pk_live_abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow(/CLERK_SECRET_KEY contains non-ASCII characters/);
  });

  it("reports secret and publishable key mixups without exposing values", () => {
    expect(() =>
      assertValidClerkE2EEnv({
        CLERK_SECRET_KEY: "pk_test_abcdefghijklmnopqrstuvwxyz",
        CLERK_PUBLISHABLE_KEY: "sk_test_abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow(
      /CLERK_SECRET_KEY must be a Clerk secret key.*CLERK_PUBLISHABLE_KEY must be a Clerk publishable key/,
    );
  });
});
