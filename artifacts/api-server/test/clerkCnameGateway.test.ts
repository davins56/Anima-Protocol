import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyClerkCnameResponseHeaders,
  clerkCnameUpstreamUrl,
  cookieHeaderForClerkCnameOAuth,
  handleClerkCnameGateway,
  isClerkCnameRequestHost,
  rewriteClerkCnameLocation,
  rewriteClerkCnameSetCookie,
  shouldForwardClerkCnameSetCookie,
} from "../src/lib/clerkCnameGateway";
import {
  CLERK_CNAME_RESOLVE_OVERRIDE,
  clerkFrontendFetchInit,
} from "../src/lib/clerkFrontendFetch";
import {
  extractGitHubAuthorizeUrlFromSignInPayload,
  extractGitHubOAuthState,
  rememberGitHubOAuthClientState,
} from "../src/lib/clerkOAuthStateStore";

const USER_JSON = {
  errors: [
    {
      message: "Unauthorized request",
      long_message: "You are not authorized to perform this request",
      code: "authorization_invalid",
    },
  ],
  clerk_trace_id: "66f4d3e123a2e78e9ba95a161789e340",
};

describe("clerk CNAME gateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies resolveOverride only for the production CNAME host", () => {
    expect(
      clerkFrontendFetchInit("https://clerk.anima-protocol.com/v1/client").cf,
    ).toEqual({ resolveOverride: CLERK_CNAME_RESOLVE_OVERRIDE });
    expect(
      clerkFrontendFetchInit("https://frontend-api.clerk.dev/v1/environment").cf,
    ).toBeUndefined();
    expect(
      clerkFrontendFetchInit(
        "https://something.clerk.accounts.dev/v1/client",
      ).cf,
    ).toBeUndefined();
  });

  it("recognizes only the Clerk custom-domain host", () => {
    expect(isClerkCnameRequestHost("clerk.anima-protocol.com")).toBe(true);
    expect(isClerkCnameRequestHost("CLERK.anima-protocol.com:443")).toBe(true);
    expect(isClerkCnameRequestHost("anima-protocol.com")).toBe(false);
    expect(isClerkCnameRequestHost("www.anima-protocol.com")).toBe(false);
  });

  it("sends oauth_callback err_code to the SPA instead of staying on clerk host", () => {
    expect(
      rewriteClerkCnameLocation(
        "/v1/oauth_callback?err_code=authorization_invalid#",
      ),
    ).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
    expect(
      rewriteClerkCnameLocation(
        "https://anima-protocol.com/sign-in/sso-callback?__clerk_status=complete",
      ),
    ).toBe(
      "https://anima-protocol.com/sign-in/sso-callback?__clerk_status=complete",
    );
  });

  it("drops Domain=apex UAT leftovers that poison the next GitHub hop", () => {
    expect(
      shouldForwardClerkCnameSetCookie(
        "__client_uat=0; Path=/; Domain=anima-protocol.com; Max-Age=315360000; Secure; SameSite=Lax",
      ),
    ).toBe(false);
    expect(
      rewriteClerkCnameSetCookie(
        "__client=tok; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
      ),
    ).toMatch(/__client=tok/);
    expect(
      rewriteClerkCnameSetCookie(
        "__client=tok; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
      ),
    ).toMatch(/Domain=anima-protocol\.com/);
  });

  it("303s oauth_callback without code+state and never hits Clerk", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("CNAME oauth_callback without code must not hit Clerk");
    });
    const response = await handleClerkCnameGateway(
      new Request("https://clerk.anima-protocol.com/v1/oauth_callback"),
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
  });

  it("hides the user-visible 403 JSON after 301 err_code", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(USER_JSON), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    });
    const response = await handleClerkCnameGateway(
      new Request(
        "https://clerk.anima-protocol.com/v1/oauth_callback?code=used&state=abc",
      ),
      fetchImpl,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
    expect(await response.text()).toBe("");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://frontend-api.clerk.dev/v1/oauth_callback?code=used&state=abc",
    );
    expect(
      (fetchImpl.mock.calls[0]?.[1] as { cf?: { resolveOverride?: string } })?.cf
        ?.resolveOverride,
    ).toBeUndefined();
  });

  it("fetches /v1/environment from shared FAPI with official proxy headers", async () => {
    process.env.CLERK_SECRET_KEY = "sk_live_test";
    expect(
      clerkCnameUpstreamUrl("https://clerk.anima-protocol.com/v1/environment")
        .toString(),
    ).toBe("https://frontend-api.clerk.dev/v1/environment");
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ auth_config: {}, display_config: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const response = await handleClerkCnameGateway(
      new Request("https://clerk.anima-protocol.com/v1/environment"),
      fetchImpl,
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text()).auth_config).toEqual({});
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://frontend-api.clerk.dev/v1/environment",
    );
    const init = fetchImpl.mock.calls[0]?.[1] as {
      headers?: Headers;
      cf?: { resolveOverride?: string };
    };
    expect(init.cf?.resolveOverride).toBeUndefined();
    expect(init.headers?.get("Clerk-Proxy-Url")).toBe(
      "https://anima-protocol.com/api/__clerk/",
    );
    expect(init.headers?.get("Clerk-Secret-Key")).toBe("sk_live_test");
    expect(init.headers?.get("X-Forwarded-Host")).toBe("anima-protocol.com");
    delete process.env.CLERK_SECRET_KEY;
  });

  it("rewrites a successful Clerk 303 onto the SPA and strips planted UAT", async () => {
    const headers = new Headers({
      location: "/sign-in/sso-callback?__clerk_handshake=tok",
    });
    headers.append(
      "set-cookie",
      "__client_uat=0; Path=/; Domain=anima-protocol.com; Secure; SameSite=Lax",
    );
    headers.append(
      "set-cookie",
      "__client=sess; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
    );
    const fetchImpl = vi.fn(async () => new Response(null, { status: 303, headers }));
    const response = await handleClerkCnameGateway(
      new Request(
        "https://clerk.anima-protocol.com/v1/oauth_callback?code=real&state=abc",
        { headers: { cookie: "__client=sess; __client_uat=0" } },
      ),
      fetchImpl,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://anima-protocol.com/sign-in/sso-callback?__clerk_handshake=tok",
    );
    const cookies = response.headers.getSetCookie?.() || [
      response.headers.get("set-cookie") || "",
    ];
    expect(cookies.join("\n")).toMatch(/__client=sess/);
    expect(cookies.join("\n")).not.toMatch(/__client_uat=/);
  });

  it("injects a stashed __client when Safari omitted it on the CNAME hop", async () => {
    const memory = new Map<string, Response>();
    const cache = {
      async match(request: Request) {
        return memory.get(request.url);
      },
      async put(request: Request, response: Response) {
        memory.set(request.url, response);
      },
    };
    await rememberGitHubOAuthClientState("state-from-github", "stashed-token", cache);
    vi.stubGlobal("caches", { default: cache });

    const cookie = await cookieHeaderForClerkCnameOAuth(
      new Request(
        "https://clerk.anima-protocol.com/v1/oauth_callback?code=x&state=state-from-github",
      ),
    );
    expect(cookie).toBe("__client=stashed-token");
    expect(cookie).not.toContain("__client_uat");
  });

  it("keeps a real __client and still strips leftover UAT on the CNAME hop", async () => {
    const cookie = await cookieHeaderForClerkCnameOAuth(
      new Request(
        "https://clerk.anima-protocol.com/v1/oauth_callback?code=x&state=abc",
        { headers: { cookie: "__client=browser-token; __client_uat=0" } },
      ),
    );
    expect(cookie).toBe("__client=browser-token");
  });

  it("reads GitHub state from a FAPI sign_ins envelope", () => {
    const authorize =
      "https://github.com/login/oauth/authorize?client_id=Ov23liAm73tVoGvOqrt2&state=abc123&redirect_uri=https%3A%2F%2Fclerk.anima-protocol.com%2Fv1%2Foauth_callback";
    expect(
      extractGitHubOAuthState(
        extractGitHubAuthorizeUrlFromSignInPayload({
          response: {
            first_factor_verification: {
              external_verification_redirect_url: authorize,
            },
          },
        }),
      ),
    ).toBe("abc123");
  });

  it("copies rewritten Location onto a gateway Response", () => {
    const headers = new Headers();
    applyClerkCnameResponseHeaders(
      new Response(null, {
        status: 301,
        headers: {
          location: "/v1/oauth_callback?err_code=authorization_invalid#",
        },
      }),
      headers,
    );
    expect(headers.get("location")).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
  });
});
