import { describe, expect, it } from "vitest";
import { clerkErrorMessage, hasEmailCodeFactor } from "./emailCodeSignIn";

describe("hasEmailCodeFactor", () => {
  it("returns true when email_code is offered", () => {
    expect(
      hasEmailCodeFactor([
        { strategy: "email_link" },
        { strategy: "email_code" },
        { strategy: "oauth_github" },
      ]),
    ).toBe(true);
  });

  it("returns false when only magic link / oauth are offered", () => {
    expect(
      hasEmailCodeFactor([
        { strategy: "email_link" },
        { strategy: "oauth_github" },
      ]),
    ).toBe(false);
  });

  it("handles empty input", () => {
    expect(hasEmailCodeFactor(undefined)).toBe(false);
    expect(hasEmailCodeFactor([])).toBe(false);
  });
});

describe("clerkErrorMessage", () => {
  it("reads nested Clerk API errors", () => {
    expect(
      clerkErrorMessage({
        errors: [{ code: "form_identifier_not_found", message: "Couldn't find your account." }],
      }),
    ).toBe("Couldn't find your account.");
  });

  it("reads Future API longMessage", () => {
    expect(clerkErrorMessage({ longMessage: "Invalid code", message: "x" })).toBe(
      "Invalid code",
    );
  });

  it("returns null for empty values", () => {
    expect(clerkErrorMessage(null)).toBeNull();
    expect(clerkErrorMessage({})).toBeNull();
  });
});
