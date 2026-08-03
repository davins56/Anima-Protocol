import { describe, expect, it, vi } from "vitest";
import {
  asSearchText,
  clerkErrorMessage,
  hasEmailCodeFactor,
  humanizeIdentifierError,
  startGitHubOAuthSignIn,
} from "./emailCodeSignIn";

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

describe("asSearchText", () => {
  it("tolerates non-string Clerk fields", () => {
    expect(asSearchText({ message: "The string did not match the expected pattern." })).toMatch(
      /pattern/,
    );
    expect(asSearchText(["Form", "Param"])).toBe("form param");
    expect(asSearchText(undefined)).toBe("");
  });
});

describe("humanizeIdentifierError", () => {
  it("rewrites pattern / format failures into actionable copy", () => {
    expect(
      humanizeIdentifierError("The string did not match the expected pattern.", null),
    ).toMatch(/typos/i);
  });

  it("preserves non-format Clerk parameter messages", () => {
    const clerkMessage = "This parameter is invalid for the requested strategy.";

    expect(
      humanizeIdentifierError(clerkMessage, "form_param_value_invalid"),
    ).toBe(clerkMessage);
  });

  it("does not throw when message/code are objects", () => {
    expect(() =>
      humanizeIdentifierError(
        { message: "The string did not match the expected pattern." },
        { code: "form_param_format_invalid" },
      ),
    ).not.toThrow();
    expect(
      humanizeIdentifierError(
        { message: "The string did not match the expected pattern." },
        "form_param_format_invalid",
      ),
    ).toMatch(/typos/i);
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

  it("preserves nested non-format Clerk parameter errors", () => {
    const clerkMessage = "This parameter is invalid for the requested strategy.";

    expect(
      clerkErrorMessage({
        errors: [{ code: "form_param_value_invalid", message: clerkMessage }],
      }),
    ).toBe(clerkMessage);
  });

  it("reads Future API longMessage", () => {
    expect(clerkErrorMessage({ longMessage: "Invalid code", message: "x" })).toBe(
      "Invalid code",
    );
  });

  it("humanizes pattern mismatch errors", () => {
    expect(
      clerkErrorMessage({
        errors: [
          {
            code: "form_param_format_invalid",
            message: "The string did not match the expected pattern.",
          },
        ],
      }),
    ).toMatch(/typos/i);
  });

  it("handles object-shaped message fields without crashing", () => {
    expect(
      clerkErrorMessage({
        message: { message: "The string did not match the expected pattern." },
        code: "form_param_format_invalid",
      }),
    ).toMatch(/typos/i);
  });

  it("returns null for empty values", () => {
    expect(clerkErrorMessage(null)).toBeNull();
    expect(clerkErrorMessage({})).toBeNull();
  });
});

describe("startGitHubOAuthSignIn", () => {
  it("uses signIn.sso with relative Clerk paths", async () => {
    const sso = vi.fn(async () => ({ error: null }));
    const result = await startGitHubOAuthSignIn({ sso }, "");
    expect(sso).toHaveBeenCalledWith({
      strategy: "oauth_github",
      redirectCallbackUrl: "/sign-in/sso-callback",
      redirectUrl: "/",
    });
    expect(result.method).toBe("signIn.sso");
  });

  it("falls back to legacy authenticateWithRedirect on signIn", async () => {
    const authenticateWithRedirect = vi.fn(async () => {});
    const result = await startGitHubOAuthSignIn({ authenticateWithRedirect }, "/app");
    expect(authenticateWithRedirect).toHaveBeenCalledWith({
      strategy: "oauth_github",
      redirectUrl: "/app/sign-in/sso-callback",
      redirectUrlComplete: "/app",
    });
    expect(result.method).toBe("authenticateWithRedirect");
  });

  it("throws a clear error when no OAuth method exists", async () => {
    await expect(startGitHubOAuthSignIn({}, "")).rejects.toThrow(/GitHub sign-in is unavailable/i);
  });

  it("surfaces Clerk sso errors", async () => {
    const error = { message: "redirect_uri_mismatch" };
    await expect(
      startGitHubOAuthSignIn({ sso: async () => ({ error }) }, ""),
    ).rejects.toEqual(error);
  });
});
