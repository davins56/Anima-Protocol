import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asSearchText,
  clerkErrorMessage,
  clerkOAuthProviderRedirectUrl,
  createGitHubOAuthViaFapi,
  CLERK_GITHUB_OAUTH_CALLBACK_URL,
  GITHUB_OAUTH_NAVIGATION_GRACE_MS,
  GITHUB_OAUTH_SSO_TIMEOUT_MS,
  githubOAuthHangMessage,
  githubOAuthNeedsIdentifierMessage,
  hasEmailCodeFactor,
  humanizeIdentifierError,
  interpretGitHubSsoResult,
  isAlreadySignedInError,
  isIncompleteOAuthSignInStatus,
  waitForPageNavigation,
  watchPageNavigation,
  isPatternFormatError,
  isPreviewSignInHost,
  previewSignInHint,
  PRODUCTION_SIGN_IN_URL,
  recoverExistingClerkSession,
  signInNeedsForcedOAuthCreate,
  startGitHubOAuthSignIn,
} from "./emailCodeSignIn";
import {
  CLERK_AUTH_RETURN_KEY,
  GUEST_CHOSEN_SESSION_KEY,
  LOCAL_AUTH_STORAGE_KEY,
  readClerkAuthReturn,
} from "./authBootPolicy";

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

  it("surfaces GitHub hang errors with the production URL and OAuth callback", () => {
    const hang = new Error(githubOAuthHangMessage());
    hang.code = "oauth_redirect_timeout";
    expect(clerkErrorMessage(hang, { context: "oauth", previewHost: false })).toBe(
      githubOAuthHangMessage(),
    );
    expect(clerkErrorMessage(hang, { context: "oauth", previewHost: false })).toContain(
      PRODUCTION_SIGN_IN_URL,
    );
    expect(clerkErrorMessage(hang, { context: "oauth", previewHost: false })).toContain(
      CLERK_GITHUB_OAUTH_CALLBACK_URL,
    );
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

describe("githubOAuthHangMessage", () => {
  it("includes the production sign-in URL and GitHub OAuth callback", () => {
    const message = githubOAuthHangMessage();
    expect(message).toContain(PRODUCTION_SIGN_IN_URL);
    expect(message).toContain(CLERK_GITHUB_OAUTH_CALLBACK_URL);
    expect(GITHUB_OAUTH_SSO_TIMEOUT_MS).toBeGreaterThanOrEqual(8000);
    expect(GITHUB_OAUTH_SSO_TIMEOUT_MS).toBeLessThanOrEqual(12000);
  });
});

describe("interpretGitHubSsoResult", () => {
  it("treats navigation as success even without a status", () => {
    expect(interpretGitHubSsoResult({ status: null }, { didNavigate: true })).toEqual({
      ok: true,
      navigated: true,
      shouldFinalize: false,
    });
  });

  it("finalizes when Clerk reports complete without a page navigation", () => {
    expect(interpretGitHubSsoResult({ status: "complete" })).toEqual({
      ok: true,
      navigated: false,
      shouldFinalize: true,
      status: "complete",
    });
  });

  it("surfaces incomplete needs_* statuses without blaming the GitHub App allowlist", () => {
    expect(isIncompleteOAuthSignInStatus("needs_second_factor")).toBe(true);
    const result = interpretGitHubSsoResult({ status: "needs_identifier" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("oauth_incomplete");
    expect(result.error?.message).toBe(githubOAuthNeedsIdentifierMessage("needs_identifier"));
    expect(result.error?.message).not.toContain(CLERK_GITHUB_OAUTH_CALLBACK_URL);
    expect(result.error?.message).toContain(PRODUCTION_SIGN_IN_URL);
  });

  it("treats a quiet return with no status as a missing redirect", () => {
    const result = interpretGitHubSsoResult({ status: null });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("oauth_no_redirect");
    expect(result.error?.message).toBe(githubOAuthHangMessage());
  });
});

describe("watchPageNavigation", () => {
  it("marks navigation on pagehide and can be disposed", () => {
    const target = {
      listeners: {},
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      },
      removeEventListener(type) {
        delete this.listeners[type];
      },
    };
    const watcher = watchPageNavigation(target);
    expect(watcher.didNavigate()).toBe(false);
    target.listeners.pagehide();
    expect(watcher.didNavigate()).toBe(true);
    watcher.dispose();
    expect(target.listeners.pagehide).toBeUndefined();
  });

  it("does not treat a backgrounded tab as navigation", () => {
    const watcher = watchPageNavigation({
      addEventListener() {},
      removeEventListener() {},
    });
    expect(watcher.didNavigate()).toBe(false);
    watcher.dispose();
  });
});

describe("waitForPageNavigation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when navigation already started", async () => {
    await expect(waitForPageNavigation(() => true, 400)).resolves.toBe(true);
  });

  it("waits the grace window for a late page leave", async () => {
    vi.useFakeTimers();
    let navigated = false;
    const pending = waitForPageNavigation(() => navigated, 400);
    navigated = true;
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBe(true);
  });
});

describe("startGitHubOAuthSignIn", () => {
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.removeItem(CLERK_AUTH_RETURN_KEY);
    sessionStorage.removeItem(GUEST_CHOSEN_SESSION_KEY);
    localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
  });

  it("marks Clerk return and clears leftover guest before GitHub redirect", async () => {
    sessionStorage.setItem(GUEST_CHOSEN_SESSION_KEY, "1");
    localStorage.setItem(
      LOCAL_AUTH_STORAGE_KEY,
      JSON.stringify({ id: "user_seeker", is_guest: true }),
    );
    const expireApexUat = vi.fn();
    const sso = vi.fn(async () => ({ error: null }));
    await startGitHubOAuthSignIn({ sso, status: "complete" }, "", null, {
      expireApexUat,
    });
    expect(expireApexUat).toHaveBeenCalledTimes(1);
    expect(sso).toHaveBeenCalled();
    expect(expireApexUat.mock.invocationCallOrder[0]).toBeLessThan(
      sso.mock.invocationCallOrder[0],
    );
    expect(readClerkAuthReturn()).toBe(true);
    expect(sessionStorage.getItem(GUEST_CHOSEN_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(LOCAL_AUTH_STORAGE_KEY)).toBeNull();
  });

  it("uses signIn.sso with relative Clerk paths", async () => {
    const sso = vi.fn(async () => ({ error: null }));
    const result = await startGitHubOAuthSignIn({ sso, status: "complete" }, "");
    expect(sso).toHaveBeenCalledWith({
      strategy: "oauth_github",
      redirectCallbackUrl: "/sign-in/sso-callback",
      redirectUrl: "/chat",
    });
    expect(result.method).toBe("signIn.sso");
    expect(result.shouldFinalize).toBe(true);
  });

  it("falls back to legacy authenticateWithRedirect on signIn", async () => {
    const authenticateWithRedirect = vi.fn(async () => {});
    const result = await startGitHubOAuthSignIn(
      { authenticateWithRedirect, status: "complete" },
      "/app",
    );
    expect(authenticateWithRedirect).toHaveBeenCalledWith({
      strategy: "oauth_github",
      redirectUrl: "/app/sign-in/sso-callback",
      redirectUrlComplete: "/app/chat",
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

  it("times out when sso never resolves or navigates", async () => {
    vi.useFakeTimers();
    const sso = vi.fn(() => new Promise(() => {}));
    const pending = startGitHubOAuthSignIn({ sso }, "", null, { timeoutMs: 10_000 });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "oauth_redirect_timeout",
      message: githubOAuthHangMessage(),
    });
    await vi.advanceTimersByTimeAsync(9_999);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it("throws when sso returns without error, navigation, or a complete status", async () => {
    await expect(
      startGitHubOAuthSignIn({ sso: async () => ({ error: null }), status: null }, "", null, {
        didNavigate: () => false,
        navigationGraceMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "oauth_no_redirect",
      message: githubOAuthHangMessage(),
    });
  });

  it("waits for a late Clerk redirect after sso resolves", async () => {
    vi.useFakeTimers();
    let navigated = false;
    const pending = startGitHubOAuthSignIn(
      { sso: async () => ({ error: null }), status: null },
      "",
      null,
      {
        didNavigate: () => navigated,
        navigationGraceMs: GITHUB_OAUTH_NAVIGATION_GRACE_MS,
      },
    );
    await Promise.resolve();
    navigated = true;
    await vi.advanceTimersByTimeAsync(GITHUB_OAUTH_NAVIGATION_GRACE_MS);
    await expect(pending).resolves.toMatchObject({
      method: "signIn.sso",
      navigated: true,
    });
  });

  it("throws an incomplete-status error instead of leaving the caller spinning", async () => {
    await expect(
      startGitHubOAuthSignIn(
        { sso: async () => ({ error: null }), status: "needs_client_trust" },
        "",
        null,
        { didNavigate: () => false },
      ),
    ).rejects.toMatchObject({
      code: "oauth_incomplete",
      status: "needs_client_trust",
    });
  });

  it("assigns the GitHub authorize URL when sso returns needs_identifier without navigation", async () => {
    const assignLocation = vi.fn();
    const github =
      "https://github.com/login/oauth/authorize?client_id=Ov23liAm73tVoGvOqrt2&redirect_uri=https%3A%2F%2Fclerk.anima-protocol.com%2Fv1%2Foauth_callback";
    const result = await startGitHubOAuthSignIn(
      {
        sso: async () => ({ error: null }),
        status: "needs_identifier",
        firstFactorVerification: {
          status: "unverified",
          externalVerificationRedirectURL: github,
        },
      },
      "",
      null,
      { didNavigate: () => false, assignLocation },
    );
    expect(assignLocation).toHaveBeenCalledWith(github);
    expect(result.navigated).toBe(true);
    expect(result.shouldFinalize).toBe(false);
  });

  it("skips leftover sso() and assigns a fresh GitHub URL from create", async () => {
    const assignLocation = vi.fn();
    const github =
      "https://github.com/login/oauth/authorize?client_id=Ov23liAm73tVoGvOqrt2&state=fresh";
    const sso = vi.fn(async () => ({ error: null }));
    const signIn = {
      id: "sia_leftover",
      status: "needs_identifier",
      sso,
      create: async function create() {
        this.firstFactorVerification = {
          status: "unverified",
          external_verification_redirect_url: github,
        };
        return { error: null };
      },
    };
    expect(signInNeedsForcedOAuthCreate(signIn)).toBe(true);
    const result = await startGitHubOAuthSignIn(signIn, "", null, {
      didNavigate: () => false,
      assignLocation,
      origin: "https://anima-protocol.com",
      fetchImpl: async () => {
        throw new Error("FAPI should not run when create already has a URL");
      },
    });
    expect(sso).not.toHaveBeenCalled();
    expect(assignLocation).toHaveBeenCalledWith(github);
    expect(result.method).toBe("oauth_github.create");
    expect(result.navigated).toBe(true);
  });

  it("assigns a GitHub URL from first-party FAPI when Future getters hide it", async () => {
    const assignLocation = vi.fn();
    const github =
      "https://github.com/login/oauth/authorize?client_id=Ov23liAm73tVoGvOqrt2&state=fapi";
    const result = await startGitHubOAuthSignIn(
      {
        id: "sia_opaque",
        status: "needs_identifier",
        sso: async () => ({ error: null }),
        create: async () => ({ error: null }),
      },
      "",
      null,
      {
        didNavigate: () => false,
        assignLocation,
        origin: "https://anima-protocol.com",
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            response: {
              first_factor_verification: {
                external_verification_redirect_url: github,
              },
            },
          }),
        }),
      },
    );
    expect(assignLocation).toHaveBeenCalledWith(github);
    expect(result.navigated).toBe(true);
  });

  it("reads a GitHub URL from a FAPI sign_ins envelope", () => {
    expect(
      clerkOAuthProviderRedirectUrl({
        response: {
          first_factor_verification: {
            external_verification_redirect_url:
              "https://github.com/login/oauth/authorize?client_id=x",
          },
        },
      }),
    ).toBe("https://github.com/login/oauth/authorize?client_id=x");
  });

  it("never uses the old did-not-finish + allowlist copy for needs_identifier", () => {
    const result = interpretGitHubSsoResult({ status: "needs_identifier" });
    expect(result.error?.message).toBe(
      githubOAuthNeedsIdentifierMessage("needs_identifier"),
    );
    expect(result.error?.message).not.toMatch(/did not finish \(/);
    expect(result.error?.message).not.toMatch(/must allowlist/);
  });

  it("creates a GitHub sign-in when sso skipped _create on an existing id", async () => {
    const assignLocation = vi.fn();
    const github =
      "https://github.com/login/oauth/authorize?client_id=Ov23liAm73tVoGvOqrt2&state=abc";
    const signIn = {
      id: "sia_existing",
      status: "needs_identifier",
      sso: async () => ({ error: null }),
      create: async function create() {
        this.firstFactorVerification = {
          status: "unverified",
          external_verification_redirect_url: github,
        };
        return { error: null };
      },
    };
    const result = await startGitHubOAuthSignIn(signIn, "", null, {
      didNavigate: () => false,
      assignLocation,
      origin: "https://anima-protocol.com",
    });
    expect(assignLocation).toHaveBeenCalledWith(github);
    expect(result.navigated).toBe(true);
  });

  it("posts oauth_github to the first-party Clerk proxy", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        response: {
          first_factor_verification: {
            external_verification_redirect_url:
              "https://github.com/login/oauth/authorize?client_id=x&state=1",
          },
        },
      }),
    }));
    const href = await createGitHubOAuthViaFapi({
      origin: "https://anima-protocol.com",
      redirectCallbackUrl: "/sign-in/sso-callback",
      redirectUrl: "/",
      fetchImpl,
    });
    expect(href).toContain("github.com/login/oauth/authorize");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://anima-protocol.com/api/__clerk/v1/client/sign_ins?__clerk_api_version=2025-11-10",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("rejects non-GitHub provider URLs", () => {
    expect(
      clerkOAuthProviderRedirectUrl({
        firstFactorVerification: {
          externalVerificationRedirectURL: "https://evil.example/oauth",
        },
      }),
    ).toBeNull();
    expect(
      clerkOAuthProviderRedirectUrl({
        first_factor_verification: {
          external_verification_redirect_url:
            "https://github.com/login/oauth/authorize?client_id=x",
        },
      }),
    ).toBe("https://github.com/login/oauth/authorize?client_id=x");
  });

  it("does not treat a hang as an error if the page already started navigating", async () => {
    const sso = vi.fn(async () => ({ error: null }));
    const result = await startGitHubOAuthSignIn({ sso, status: null }, "", null, {
      didNavigate: () => true,
    });
    expect(result.navigated).toBe(true);
    expect(result.method).toBe("signIn.sso");
  });
});
