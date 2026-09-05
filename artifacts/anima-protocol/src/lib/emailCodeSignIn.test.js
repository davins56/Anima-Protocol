import { describe, expect, it, vi } from "vitest";
import {
  asSearchText,
  clerkErrorMessage,
  hasEmailCodeFactor,
  humanizeIdentifierError,
  isAlreadySignedInError,
  isPatternFormatError,
  isPreviewSignInHost,
  previewSignInHint,
  PRODUCTION_SIGN_IN_URL,
  recoverExistingClerkSession,
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

describe("isPatternFormatError", () => {
  it("detects Clerk format-invalid codes and pattern text", () => {
    expect(
      isPatternFormatError("The string did not match the expected pattern.", null),
    ).toBe(true);
    expect(
      isPatternFormatError("x", "form_param_format_invalid"),
    ).toBe(true);
    expect(isPatternFormatError("Couldn't find your account.", null)).toBe(false);
  });
});

describe("isPreviewSignInHost", () => {
  it("treats any non-anima, non-local host as unauthorized for production Clerk", () => {
    expect(isPreviewSignInHost("anima-protocol-abc.vercel.app")).toBe(true);
    expect(isPreviewSignInHost("anima-protocol.replit.app")).toBe(true);
    expect(isPreviewSignInHost("www.anima-protocol.com")).toBe(false);
    expect(isPreviewSignInHost("anima-protocol.com")).toBe(false);
    expect(isPreviewSignInHost("localhost")).toBe(false);
  });
});

describe("PRODUCTION_SIGN_IN_URL", () => {
  it("uses the apex path that Cloudflare actually serves", () => {
    expect(PRODUCTION_SIGN_IN_URL).toBe("https://anima-protocol.com/sign-in");
  });
});

describe("humanizeIdentifierError", () => {
  it("rewrites pattern / format failures into actionable copy", () => {
    expect(
      humanizeIdentifierError("The string did not match the expected pattern.", null),
    ).toMatch(/typos/i);
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

  it("guides missing accounts toward username or GitHub", () => {
    expect(
      humanizeIdentifierError("Couldn't find your account.", "form_identifier_not_found"),
    ).toMatch(/GitHub/i);
  });
});

describe("clerkErrorMessage", () => {
  it("reads nested Clerk API errors", () => {
    expect(
      clerkErrorMessage({
        errors: [{ code: "form_identifier_not_found", message: "Couldn't find your account." }],
      }),
    ).toMatch(/GitHub/i);
  });

  it("preserves non-format Clerk parameter errors", () => {
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

  it("only humanizes identifier format errors when explicitly requested", () => {
    const error = {
      errors: [
        {
          code: "form_param_format_invalid",
          message: "The string did not match the expected pattern.",
        },
      ],
    };

    expect(
      clerkErrorMessage(error, { previewHost: false, context: "generic" }),
    ).toMatch(/unexpected format|production sign-in/i);
    expect(
      clerkErrorMessage(error, {
        humanizeIdentifierFormat: true,
        previewHost: false,
        context: "identifier",
      }),
    ).toMatch(/typos/i);
  });

  it("rewrites pattern errors on preview hosts to the production URL", () => {
    expect(
      clerkErrorMessage(
        {
          errors: [
            {
              code: "form_param_format_invalid",
              message: "The string did not match the expected pattern.",
            },
          ],
        },
        { previewHost: true, context: "oauth" },
      ),
    ).toBe(previewSignInHint());
    expect(previewSignInHint()).toContain(PRODUCTION_SIGN_IN_URL);
  });

  it("handles object-shaped message fields without crashing", () => {
    expect(
      clerkErrorMessage(
        {
          message: { message: "The string did not match the expected pattern." },
          code: "form_param_format_invalid",
        },
        { humanizeIdentifierFormat: true, previewHost: false },
      ),
    ).toMatch(/typos/i);
  });

  it("keeps a non-pattern code-flow message as Clerk's own text", () => {
    expect(
      clerkErrorMessage(
        {
          errors: [
            {
              code: "form_code_incorrect",
              message: "Incorrect code",
            },
          ],
        },
        { context: "code", previewHost: false },
      ),
    ).toBe("Incorrect code");
  });

  it("returns null for empty values", () => {
    expect(clerkErrorMessage(null)).toBeNull();
    expect(clerkErrorMessage({})).toBeNull();
  });
});

describe("isAlreadySignedInError", () => {
  it("detects Clerk session_exists and identifier_already_signed_in", () => {
    expect(
      isAlreadySignedInError({
        errors: [{ code: "session_exists", message: "Session already exists" }],
      }),
    ).toBe(true);
    expect(
      isAlreadySignedInError({
        errors: [
          {
            code: "identifier_already_signed_in",
            message: "You're already signed in",
            meta: { sessionId: "sess_123" },
          },
        ],
      }),
    ).toBe(true);
    expect(
      isAlreadySignedInError({
        errors: [{ code: "form_identifier_not_found", message: "Nope" }],
      }),
    ).toBe(false);
  });
});

describe("recoverExistingClerkSession", () => {
  it("activates the session id from the Clerk error meta", async () => {
    const setActive = vi.fn(async () => {});
    const sessionId = await recoverExistingClerkSession(
      { setActive, client: { lastActiveSessionId: "sess_fallback" } },
      {
        errors: [
          {
            code: "identifier_already_signed_in",
            meta: { sessionId: "sess_from_error" },
          },
        ],
      },
    );
    expect(sessionId).toBe("sess_from_error");
    expect(setActive).toHaveBeenCalledWith({ session: "sess_from_error" });
  });

  it("falls back to the client last active session", async () => {
    const setActive = vi.fn(async () => {});
    const sessionId = await recoverExistingClerkSession(
      { setActive, client: { lastActiveSessionId: "sess_last" } },
      { errors: [{ code: "session_exists" }] },
    );
    expect(sessionId).toBe("sess_last");
    expect(setActive).toHaveBeenCalledWith({ session: "sess_last" });
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
