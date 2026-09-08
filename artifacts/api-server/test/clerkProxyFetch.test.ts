import { describe, expect, it, vi } from "vitest";
import {
  buildClerkProxyHeaderValues,
  buildClerkUpstreamHeaders,
  clerkFrontendApiBaseFromPublishableKey,
  clientIpFromHeaders,
  forwardedRequestProto,
  isClerkHandshakeRequest,
  isClerkSsoCallbackReferer,
  shouldStripClerkAuthCookies,
  proxyClerkWithFetch,
  resolveClerkNpmRedirectUrl,
  resolveClerkUpstreamPath,
  resolveClerkUpstreamUrl,
  rewriteClerkProxyLocation,
  rewriteClerkProxySetCookie,
  shouldAuthorizeClerkUpstream,
  isClerkOAuthCallbackPath,
  isClerkSignInsPath,
  clerkOAuthCallbackShouldBypassUpstream,
  clerkOAuthCallbackShouldHideUpstreamBody,
  clerkOAuthCallbackSignInRedirect,
  apexClerkAuthCookieExpiries,
  collectClerkAuthCookieNames,
  isClerkClientTokenCookieName,
  isClerkClientUatCookieName,
  stripClerkAuthCookies,
  usesOfficialClerkProxyProtocol,
} from "../src/middlewares/clerkProxyFetch";

const CUSTOM_DOMAIN_KEY = "pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29t";

describe("clerkProxyFetch", () => {
  it("maps proxy paths to frontend-api.clerk.dev", () => {
    expect(resolveClerkUpstreamUrl("/v1/environment").toString()).toBe(
      "https://frontend-api.clerk.dev/v1/environment",
    );
    expect(
      resolveClerkUpstreamUrl(
        "/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
      ).toString(),
    ).toBe(
      "https://frontend-api.clerk.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
    );
  });

  it("sets Clerk proxy headers for production hosts", () => {
    process.env.CLERK_PUBLISHABLE_KEY =
      "pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA"; // pragma: allowlist secret

    const values = buildClerkProxyHeaderValues(
      {
        headers: {
          host: "www.anima-protocol.com",
          "x-forwarded-proto": "https",
        },
      },
      "sk_live_test", // pragma: allowlist secret
    );

    expect(values.proxyUrl).toBe(
      "https://www.anima-protocol.com/api/__clerk/",
    );
    expect(values.origin).toBe("https://www.anima-protocol.com");

    const headers = buildClerkUpstreamHeaders(
      {
        method: "GET",
        headers: {
          host: "www.anima-protocol.com",
          accept: "application/json",
        },
      },
      "sk_live_test", // pragma: allowlist secret
    );

    expect(headers.get("Clerk-Proxy-Url")).toBe(
      "https://www.anima-protocol.com/api/__clerk/",
    );
    expect(headers.get("Clerk-Secret-Key")).toBe("sk_live_test");
    expect(headers.get("X-Forwarded-Host")).toBe("www.anima-protocol.com");
    expect(headers.get("X-Forwarded-Proto")).toBe("https");
    expect(headers.get("Host")).toBeNull();
    expect(headers.get("Origin")).toBe("https://www.anima-protocol.com");
  });

  it("prefers CF-Connecting-IP over spoofable X-Forwarded-For", () => {
    expect(
      clientIpFromHeaders({
        "x-forwarded-for": "203.0.113.1, 198.51.100.2",
        "cf-connecting-ip": "198.51.100.10",
        "x-real-ip": "203.0.113.9",
      }),
    ).toBe("198.51.100.10");
    expect(
      clientIpFromHeaders({
        "x-forwarded-for": "203.0.113.1, 198.51.100.2",
      }),
    ).toBe("203.0.113.1");
  });

  it("does not forward Authorization when Origin is set", () => {
    const headers = buildClerkUpstreamHeaders(
      {
        method: "GET",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          authorization: "Bearer pk_live_dummy",
          accept: "application/json",
        },
      },
      "sk_live_test",
      { officialProxy: false, authorizeUpstream: true },
    );
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Origin")).toBe("https://anima-protocol.com");
  });

  it("derives upstream path from originalUrl when mount path is missing", () => {
    expect(
      resolveClerkUpstreamPath({
        url: "/api",
        originalUrl: "/api/__clerk/v1/environment",
      } as import("http").IncomingMessage),
    ).toBe("/v1/environment");
  });

  it("falls back to the apex proxy host when request host headers are missing", () => {
    process.env.CLERK_PUBLISHABLE_KEY =
      "pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA"; // pragma: allowlist secret

    const values = buildClerkProxyHeaderValues(
      { headers: {} },
      "sk_live_test", // pragma: allowlist secret
    );

    expect(values.proxyUrl).toBe(
      "https://anima-protocol.com/api/__clerk/",
    );
  });

  it("keeps apex Origin when the browser is on anima-protocol.com", () => {
    process.env.CLERK_PUBLISHABLE_KEY =
      "pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA"; // pragma: allowlist secret
    const values = buildClerkProxyHeaderValues(
      {
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          "x-forwarded-proto": "https",
        },
      },
      "sk_live_test",
    );
    expect(values.origin).toBe("https://anima-protocol.com");
    expect(values.proxyUrl).toBe("https://anima-protocol.com/api/__clerk/");
  });

  it("uses the first x-forwarded-proto hop so Origin matches Clerk-Proxy-Url", () => {
    expect(forwardedRequestProto({ "x-forwarded-proto": "https,https" })).toBe(
      "https",
    );
    expect(forwardedRequestProto({ "x-forwarded-proto": "https, http" })).toBe(
      "https",
    );
    expect(forwardedRequestProto({ "x-forwarded-proto": ["http"] })).toBe(
      "http",
    );

    process.env.CLERK_PUBLISHABLE_KEY =
      "[REDACTED]"; // pragma: allowlist secret

    const values = buildClerkProxyHeaderValues(
      {
        headers: {
          host: "www.anima-protocol.com",
          "x-forwarded-proto": "https,https",
        },
      },
      "sk_live_test", // pragma: allowlist secret
    );

    expect(values.origin).toBe("https://www.anima-protocol.com");
    expect(values.proxyUrl).toBe(
      "https://www.anima-protocol.com/api/__clerk/",
    );
  });

  it("uses dashboard apex proxy headers for localhost pk_live_ dev", () => {
    process.env.CLERK_PUBLISHABLE_KEY =
      "pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA"; // pragma: allowlist secret

    const values = buildClerkProxyHeaderValues(
      {
        headers: {
          host: "localhost:23660",
          origin: "http://localhost:23660",
        },
      },
      "sk_live_test", // pragma: allowlist secret
    );

    expect(values.proxyUrl).toBe(
      "https://anima-protocol.com/api/__clerk/",
    );
    expect(values.origin).toBe("https://anima-protocol.com");
  });

  it("proxies a custom-domain publishable key to that FAPI host", () => {
    expect(clerkFrontendApiBaseFromPublishableKey(CUSTOM_DOMAIN_KEY)).toBe(
      "https://clerk.anima-protocol.com",
    );
    expect(
      usesOfficialClerkProxyProtocol(
        clerkFrontendApiBaseFromPublishableKey(CUSTOM_DOMAIN_KEY),
      ),
    ).toBe(false);
    expect(
      resolveClerkUpstreamUrl(
        "/v1/environment",
        clerkFrontendApiBaseFromPublishableKey(CUSTOM_DOMAIN_KEY),
      ).toString(),
    ).toBe("https://clerk.anima-protocol.com/v1/environment");
  });

  it("omits official proxy headers when talking to a custom FAPI domain", () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const headers = buildClerkUpstreamHeaders(
      {
        method: "GET",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          accept: "application/json",
        },
      },
      "sk_live_test",
      { officialProxy: false },
    );
    expect(headers.get("Clerk-Proxy-Url")).toBeNull();
    expect(headers.get("X-Forwarded-Host")).toBeNull();
    expect(headers.get("Clerk-Secret-Key")).toBeNull();
    expect(headers.get("Origin")).toBe("https://anima-protocol.com");
  });

  it("authorizes CNAME FAPI /v1 with the secret but not Clerk-Proxy-Url", () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const headers = buildClerkUpstreamHeaders(
      {
        method: "GET",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          accept: "application/json",
          "cf-connecting-ip": "198.51.100.20",
          "x-forwarded-for": "203.0.113.1",
        },
      },
      "sk_live_test",
      { officialProxy: false, authorizeUpstream: true },
    );
    expect(headers.get("Clerk-Proxy-Url")).toBeNull();
    expect(headers.get("X-Forwarded-Host")).toBeNull();
    expect(headers.get("Clerk-Secret-Key")).toBe("sk_live_test");
    expect(headers.get("X-Forwarded-For")).toBe("198.51.100.20");
    expect(headers.get("Origin")).toBe("https://anima-protocol.com");
  });

  it("rewrites CNAME-cloaked Clerk cookies onto the app origin", () => {
    expect(isClerkClientTokenCookieName("__client")).toBe(true);
    expect(isClerkClientTokenCookieName("__client_uat")).toBe(false);
    // GitHub oauth_callback on clerk.{apex} authenticates with __client.
    // Host-only is invisible there → 301 authorization_invalid.
    expect(
      rewriteClerkProxySetCookie(
        "__client=abc; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
        "anima-protocol.com",
      ),
    ).toBe(
      "__client=abc; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=anima-protocol.com",
    );
    expect(
      rewriteClerkProxySetCookie(
        "__client=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
        "www.anima-protocol.com",
      ),
    ).toBe(
      "__client=abc; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=anima-protocol.com",
    );
    expect(
      rewriteClerkProxySetCookie(
        "__client_uat=1; Path=/; Domain=anima-protocol.com; Secure; SameSite=Lax",
        "anima-protocol.com",
      ),
    ).toBe("__client_uat=1; Path=/; Secure; SameSite=Lax");
    expect(
      rewriteClerkProxySetCookie(
        "__client_uat_23i07izR=0; Path=/; Domain=.anima-protocol.com; Secure; SameSite=Lax",
        "anima-protocol.com",
      ),
    ).toBe("__client_uat_23i07izR=0; Path=/; Secure; SameSite=Lax");
    expect(
      rewriteClerkProxySetCookie(
        "__cf_bm=x; Path=/; Domain=.clerkprod-cloudflare.net; HttpOnly; Secure; SameSite=None",
        "anima-protocol.com",
      ),
    ).toBeNull();
    expect(
      rewriteClerkProxySetCookie(
        "__session=tok; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
        "anima-protocol.com",
      ),
    ).toBe("__session=tok; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(
      rewriteClerkProxySetCookie(
        "__refresh_abc=tok; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
        "anima-protocol.com",
      ),
    ).toBe("__refresh_abc=tok; Path=/; HttpOnly; Secure; SameSite=Lax");
  });

  it("strips orphan Clerk session cookies on handshake FAPI calls", () => {
    expect(
      stripClerkAuthCookies(
        "__session=stale; __client_uat=0; theme=dark; __client=old",
      ),
    ).toBe("theme=dark");
    expect(isClerkHandshakeRequest("/v1/client/handshake?redirect_url=/")).toBe(
      true,
    );
    expect(
      isClerkHandshakeRequest(
        "/v1/client?__clerk_handshake=abc&__clerk_api_version=2026-05-12",
      ),
    ).toBe(true);
    expect(isClerkHandshakeRequest("/v1/environment")).toBe(false);

    const headers = buildClerkUpstreamHeaders(
      {
        method: "GET",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          cookie: "__session=from-cname; __client_uat=0; theme=dark",
          accept: "application/json",
        },
      },
      "sk_live_test",
      {
        officialProxy: false,
        authorizeUpstream: true,
        requestUrl:
          "/v1/client?__clerk_handshake=abc&__clerk_api_version=2026-05-12",
      },
    );
    expect(headers.get("cookie")).toBe("theme=dark");
    expect(headers.get("Clerk-Proxy-Url")).toBeNull();
    expect(headers.get("Clerk-Secret-Key")).toBe("sk_live_test");
  });

  it("keeps Clerk cookies on ordinary /v1/client calls", () => {
    const headers = buildClerkUpstreamHeaders(
      {
        method: "GET",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          cookie: "__client=keep; __session=keep",
          accept: "application/json",
        },
      },
      "sk_live_test",
      {
        officialProxy: false,
        authorizeUpstream: true,
        requestUrl: "/v1/client?__clerk_api_version=2026-05-12",
      },
    );
    expect(headers.get("cookie")).toBe("__client=keep; __session=keep");
  });

  it("keeps Clerk cookies on /v1/client even when Referer is the SSO callback", () => {
    expect(
      isClerkSsoCallbackReferer(
        "https://anima-protocol.com/sign-in/sso-callback?__clerk_handshake=abc",
      ),
    ).toBe(true);
    expect(isClerkSsoCallbackReferer("https://anima-protocol.com/sign-in")).toBe(
      false,
    );
    expect(
      shouldStripClerkAuthCookies(
        "/v1/client?__clerk_api_version=2026-05-12",
        "https://anima-protocol.com/sign-in/sso-callback",
      ),
    ).toBe(false);
    expect(
      shouldStripClerkAuthCookies(
        "/v1/client?__clerk_handshake=abc&__clerk_api_version=2026-05-12",
        "https://anima-protocol.com/sign-in/sso-callback",
      ),
    ).toBe(true);

    const headers = buildClerkUpstreamHeaders(
      {
        method: "GET",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          referer: "https://anima-protocol.com/sign-in/sso-callback?__clerk_handshake=abc",
          cookie: "__session=from-handshake; __client=tok; theme=dark",
          accept: "application/json",
        },
      },
      "sk_live_test",
      {
        officialProxy: false,
        authorizeUpstream: true,
        requestUrl: "/v1/client?__clerk_api_version=2026-05-12",
      },
    );
    expect(headers.get("cookie")).toBe(
      "__session=from-handshake; __client=tok; theme=dark",
    );
  });

  it("strips leftover UAT/session on oauth_callback but forwards __client", () => {
    expect(isClerkOAuthCallbackPath("/v1/oauth_callback?code=x&state=y")).toBe(
      true,
    );
    expect(shouldAuthorizeClerkUpstream("/v1/oauth_callback?code=x")).toBe(
      false,
    );
    expect(shouldAuthorizeClerkUpstream("/v1/client")).toBe(true);
    expect(shouldAuthorizeClerkUpstream("/npm/@clerk/clerk-js@6/dist/x.js")).toBe(
      false,
    );
    expect(
      shouldStripClerkAuthCookies("/v1/oauth_callback?code=x&state=y"),
    ).toBe(true);
    expect(collectClerkAuthCookieNames("__client_uat=0; theme=dark; __session=x")).toEqual(
      ["__client_uat", "__session"],
    );
    expect(isClerkClientUatCookieName("__client_uat")).toBe(true);
    expect(isClerkClientUatCookieName("__client")).toBe(false);
    expect(isClerkClientUatCookieName("__session")).toBe(false);
    expect(
      apexClerkAuthCookieExpiries(["__client_uat", "theme"], "www.anima-protocol.com"),
    ).toEqual([
      "__client_uat=; Path=/; Domain=anima-protocol.com; Max-Age=0; Secure; SameSite=Lax",
    ]);
    expect(
      apexClerkAuthCookieExpiries(
        ["__client", "__session", "__refresh_x", "__client_uat"],
        "anima-protocol.com",
      ),
    ).toEqual([
      "__client_uat=; Path=/; Domain=anima-protocol.com; Max-Age=0; Secure; SameSite=Lax",
    ]);

    const headers = buildClerkUpstreamHeaders(
      {
        method: "GET",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          cookie: "__client_uat=0; __client=tok; theme=dark",
          accept: "text/html",
        },
      },
      "sk_live_test",
      {
        officialProxy: false,
        authorizeUpstream: shouldAuthorizeClerkUpstream("/v1/oauth_callback"),
        requestUrl: "/v1/oauth_callback?code=fake&state=abc",
      },
    );
    expect(headers.get("cookie")).toBe("__client=tok; theme=dark");
    expect(headers.get("Clerk-Secret-Key")).toBeNull();
    expect(headers.get("Clerk-Proxy-Url")).toBeNull();
    expect(
      stripClerkAuthCookies("__client_uat=0; __client=tok; __session=x; theme=dark", {
        keepClientToken: true,
      }),
    ).toBe("__client=tok; theme=dark");
  });

  it("rewrites FAPI Location headers onto the same-origin proxy path", () => {
    expect(
      rewriteClerkProxyLocation(
        "https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6.31.0/dist/clerk.browser.js",
        {
          fapiHost: "clerk.anima-protocol.com",
          appOrigin: "https://anima-protocol.com",
        },
      ),
    ).toBe(
      "https://anima-protocol.com/api/__clerk/npm/@clerk/clerk-js@6.31.0/dist/clerk.browser.js",
    );
    expect(
      rewriteClerkProxyLocation(
        "https://clerk.anima-protocol.com/v1/client/handshake?__clerk_api_version=2025-11-10",
        {
          fapiHost: "clerk.anima-protocol.com",
          appOrigin: "https://anima-protocol.com",
        },
      ),
    ).toBe(
      "https://anima-protocol.com/api/__clerk/v1/client/handshake?__clerk_api_version=2025-11-10",
    );
  });

  it("detects FAPI sign_ins so GitHub state can be stashed", () => {
    expect(isClerkSignInsPath("/v1/client/sign_ins")).toBe(true);
    expect(
      isClerkSignInsPath("/v1/client/sign_ins?__clerk_api_version=2025-11-10"),
    ).toBe(true);
    expect(isClerkSignInsPath("/v1/client")).toBe(false);
  });

  it("sends oauth_callback err_code Locations to /sign-in, not /api/__clerk", () => {
    expect(clerkOAuthCallbackShouldBypassUpstream("/v1/oauth_callback")).toBe(
      true,
    );
    expect(
      clerkOAuthCallbackShouldBypassUpstream(
        "/v1/oauth_callback?err_code=authorization_invalid",
      ),
    ).toBe(true);
    expect(
      clerkOAuthCallbackShouldBypassUpstream(
        "/v1/oauth_callback?code=real&state=abc",
      ),
    ).toBe(false);
    expect(clerkOAuthCallbackShouldHideUpstreamBody(403)).toBe(true);
    expect(clerkOAuthCallbackShouldHideUpstreamBody(401)).toBe(true);
    expect(clerkOAuthCallbackShouldHideUpstreamBody(303)).toBe(false);
    expect(clerkOAuthCallbackSignInRedirect("https://anima-protocol.com")).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
    expect(
      rewriteClerkProxyLocation(
        "/v1/oauth_callback?err_code=authorization_invalid#",
        {
          fapiHost: "clerk.anima-protocol.com",
          appOrigin: "https://anima-protocol.com",
        },
      ),
    ).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
    expect(
      rewriteClerkProxyLocation(
        "/v1/oauth_callback?code=real&state=abc",
        {
          fapiHost: "clerk.anima-protocol.com",
          appOrigin: "https://anima-protocol.com",
        },
      ),
    ).toBe(
      "https://anima-protocol.com/api/__clerk/v1/oauth_callback?code=real&state=abc",
    );
  });

  it("sends OAuth handshake document redirects to the SPA, not /api/__clerk", () => {
    expect(
      rewriteClerkProxyLocation(
        "https://clerk.anima-protocol.com/?__clerk_handshake=abc",
        {
          fapiHost: "clerk.anima-protocol.com",
          appOrigin: "https://anima-protocol.com",
        },
      ),
    ).toBe("https://anima-protocol.com/?__clerk_handshake=abc");
    expect(
      rewriteClerkProxyLocation(
        "https://clerk.anima-protocol.com/sign-in/sso-callback?__clerk_status=complete",
        {
          fapiHost: "clerk.anima-protocol.com",
          appOrigin: "https://anima-protocol.com",
        },
      ),
    ).toBe(
      "https://anima-protocol.com/sign-in/sso-callback?__clerk_status=complete",
    );
  });

  it("follows clerk-js dist-tag 307 hops to the versioned 200 script", () => {
    const current = new URL(
      "https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
    );
    expect(
      resolveClerkNpmRedirectUrl(
        "https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6.31.0/dist/clerk.browser.js",
        current,
        "clerk.anima-protocol.com",
      )?.toString(),
    ).toBe(
      "https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6.31.0/dist/clerk.browser.js",
    );
    expect(
      resolveClerkNpmRedirectUrl(
        "https://github.com/login/oauth/authorize?client_id=x",
        current,
        "clerk.anima-protocol.com",
      ),
    ).toBeNull();
    expect(
      resolveClerkNpmRedirectUrl(
        "https://clerk.anima-protocol.com/sign-in/sso-callback",
        current,
        "clerk.anima-protocol.com",
      ),
    ).toBeNull();
  });

  it("proxies custom-domain FAPI through the app origin with first-party cookies", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const upstreamHeaders = new Headers();
    upstreamHeaders.append(
      "set-cookie",
      "__client=tok; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
    );
    upstreamHeaders.append(
      "set-cookie",
      "__client_uat=1; Path=/; Domain=anima-protocol.com; Secure; SameSite=Lax",
    );
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://clerk.anima-protocol.com/v1/environment",
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("Clerk-Proxy-Url")).toBeNull();
      expect(headers.get("X-Forwarded-Host")).toBeNull();
      expect(headers.get("Clerk-Secret-Key")).toBe("sk_live_test");
      expect(headers.get("Origin")).toBe("https://anima-protocol.com");
      return new Response("{}", { status: 200, headers: upstreamHeaders });
    });
    const cookies: string[] = [];
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader() {},
      appendHeader(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") cookies.push(value);
      },
      getHeader() {
        return undefined;
      },
      end() {},
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/v1/environment",
        originalUrl: "/api/__clerk/v1/environment",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.statusCode).toBe(200);
    expect(
      cookies.some(
        (c) =>
          c.startsWith("__client=tok") &&
          /Domain=anima-protocol\.com/i.test(c) &&
          !/Max-Age=0/i.test(c),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (c) =>
          c.startsWith("__client_uat=1") &&
          !/Domain=/i.test(c) &&
          !/Max-Age=0/i.test(c),
      ),
    ).toBe(true);
    // Ordinary FAPI must not Domain=apex-expire session or uat cookies.
    // On anima-protocol.com that Max-Age=0 also deletes the host-only copy.
    expect(
      cookies.some(
        (c) =>
          /Domain=anima-protocol\.com/i.test(c) && /Max-Age=0/i.test(c),
      ),
    ).toBe(false);
  });

  it("does not Domain=apex-expire __client/__session on /v1/client refresh", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const upstreamHeaders = new Headers();
    upstreamHeaders.append(
      "set-cookie",
      "__client=tok; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
    );
    upstreamHeaders.append(
      "set-cookie",
      "__session=sess; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
    );
    const fetchImpl = vi.fn(async () => {
      return new Response("{}", { status: 200, headers: upstreamHeaders });
    });
    const cookies: string[] = [];
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader() {},
      appendHeader(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") cookies.push(value);
      },
      getHeader() {
        return undefined;
      },
      end() {},
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/v1/client",
        originalUrl: "/api/__clerk/v1/client",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          cookie: "__client=tok; __session=sess; __client_uat=1",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(
      cookies.some(
        (c) =>
          c.startsWith("__client=tok") &&
          /Domain=anima-protocol\.com/i.test(c) &&
          !/Max-Age=0/i.test(c),
      ),
    ).toBe(true);
    expect(cookies.some((c) => c.startsWith("__session=sess") && !/Domain=/i.test(c))).toBe(
      true,
    );
    expect(
      cookies.some(
        (c) =>
          (c.startsWith("__client=") || c.startsWith("__session=")) &&
          /Domain=anima-protocol\.com/i.test(c) &&
          /Max-Age=0/i.test(c),
      ),
    ).toBe(false);
  });

  it("follows Clerk CDN 307 for unversioned clerk-js and returns 200 JS", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const unversioned =
      "https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js";
    const versioned =
      "https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6.31.0/dist/clerk.browser.js";
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const headers = new Headers(init?.headers);
      expect(headers.get("Clerk-Secret-Key")).toBeNull();
      expect(headers.get("Clerk-Proxy-Url")).toBeNull();
      if (href === unversioned) {
        return new Response(null, {
          status: 307,
          headers: { location: versioned },
        });
      }
      expect(href).toBe(versioned);
      return new Response("/* clerk-js */", {
        status: 200,
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    });
    let body: Buffer | undefined;
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader() {},
      appendHeader() {},
      getHeader() {
        return undefined;
      },
      end(payload?: Buffer) {
        body = payload;
      },
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
        originalUrl: "/api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(body?.toString()).toBe("/* clerk-js */");
  });

  it("proxies oauth_callback without Secret-Key and keeps __client", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://clerk.anima-protocol.com/v1/oauth_callback?code=fake&state=abc",
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("Clerk-Secret-Key")).toBeNull();
      expect(headers.get("Clerk-Proxy-Url")).toBeNull();
      expect(headers.get("cookie")).toBe("__client=tok; theme=dark");
      expect((init as { cf?: { resolveOverride?: string } })?.cf?.resolveOverride).toBe(
        "worker.clerkprod-cloudflare.net",
      );
      return new Response(null, {
        status: 303,
        headers: {
          location: "https://anima-protocol.com/sign-in/sso-callback?__clerk_status=failed",
        },
      });
    });
    const headers: Record<string, string> = {};
    const cookies: string[] = [];
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      appendHeader(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") cookies.push(value);
      },
      getHeader() {
        return undefined;
      },
      end() {},
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/v1/oauth_callback?code=fake&state=abc",
        originalUrl: "/api/__clerk/v1/oauth_callback?code=fake&state=abc",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          cookie: "__client_uat=0; __client=tok; theme=dark",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(303);
    expect(headers.location).toBe(
      "https://anima-protocol.com/sign-in/sso-callback?__clerk_status=failed",
    );
    expect(
      cookies.some(
        (c) =>
          /Domain=anima-protocol\.com/i.test(c) && /Max-Age=0/i.test(c),
      ),
    ).toBe(false);
  });

  it("rewrites oauth_callback 301 err_code onto /sign-in instead of /api/__clerk", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 301,
        headers: {
          location: "/v1/oauth_callback?err_code=authorization_invalid#",
        },
      });
    });
    const headers: Record<string, string> = {};
    const cookies: string[] = [];
    let body: Buffer | undefined;
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      appendHeader(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") cookies.push(value);
      },
      getHeader() {
        return undefined;
      },
      end(payload?: Buffer) {
        body = payload;
      },
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/v1/oauth_callback?code=fake&state=abc",
        originalUrl: "/api/__clerk/v1/oauth_callback?code=fake&state=abc",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(301);
    expect(headers.location).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
    expect(headers.location).not.toContain("/api/__clerk");
    expect(String(body || "")).not.toContain("authorization_invalid");
    expect(
      cookies.some(
        (c) =>
          /Domain=anima-protocol\.com/i.test(c) && /Max-Age=0/i.test(c),
      ),
    ).toBe(false);
  });

  it("hides oauth_callback 403 JSON even when code+state were present", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          errors: [
            {
              message: "Unauthorized request",
              long_message: "You are not authorized to perform this request",
              code: "authorization_invalid",
            },
          ],
          clerk_trace_id: "a46dd8711e30378a77e2a1d46640edb6",
        }),
        {
          status: 403,
          headers: {
            "content-type": "application/json",
            "set-cookie":
              "__client_uat=; Path=/; Domain=anima-protocol.com; Max-Age=0; Secure; SameSite=Lax",
          },
        },
      );
    });
    const headers: Record<string, string> = {};
    const cookies: string[] = [];
    let body: Buffer | undefined;
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      appendHeader(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") cookies.push(value);
      },
      getHeader() {
        return undefined;
      },
      end(payload?: Buffer) {
        body = payload;
      },
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/v1/oauth_callback?code=used&state=abc",
        originalUrl: "/api/__clerk/v1/oauth_callback?code=used&state=abc",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(303);
    expect(headers.location).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
    expect(body).toBeUndefined();
    expect(cookies).toEqual([]);
  });

  it("does not Domain=apex-expire UAT or return JSON on HEAD/GET oauth_callback without code", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const fetchImpl = vi.fn(async () => {
      throw new Error("oauth_callback without code must not hit Clerk");
    });
    const headers: Record<string, string> = {};
    const cookies: string[] = [];
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      appendHeader(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") cookies.push(value);
      },
      getHeader() {
        return undefined;
      },
      end() {},
    };
    await proxyClerkWithFetch(
      {
        method: "HEAD",
        url: "/v1/oauth_callback",
        originalUrl: "/api/__clerk/v1/oauth_callback",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(303);
    expect(headers.location).toBe(
      "https://anima-protocol.com/sign-in?clerk_error=authorization_invalid",
    );
    expect(cookies).toEqual([]);
  });

  it("does not Domain=apex-expire UAT when handshake fails without minting", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          errors: [{ code: "invalid_handshake", message: "invalid handshake" }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    });
    const cookies: string[] = [];
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader() {},
      appendHeader(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") cookies.push(value);
      },
      getHeader() {
        return undefined;
      },
      end() {},
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/v1/client/handshake?__clerk_handshake=fake",
        originalUrl: "/api/__clerk/v1/client/handshake?__clerk_handshake=fake",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          cookie: "__client_uat=1",
          referer: "https://anima-protocol.com/sign-in/sso-callback",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.statusCode).toBe(400);
    expect(
      cookies.some(
        (c) =>
          /Domain=anima-protocol\.com/i.test(c) && /Max-Age=0/i.test(c),
      ),
    ).toBe(false);
  });

  it("does not Domain=apex-expire __client_uat after handshake mints a host-only copy", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const upstreamHeaders = new Headers();
    upstreamHeaders.append(
      "set-cookie",
      "__client_uat=1710000000; Path=/; Domain=anima-protocol.com; Secure; SameSite=Lax",
    );
    const fetchImpl = vi.fn(async () => {
      return new Response("{}", { status: 200, headers: upstreamHeaders });
    });
    const cookies: string[] = [];
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader() {},
      appendHeader(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") cookies.push(value);
      },
      getHeader() {
        return undefined;
      },
      end() {},
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/v1/client/handshake?__clerk_handshake=abc",
        originalUrl: "/api/__clerk/v1/client/handshake?__clerk_handshake=abc",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          cookie: "__client_uat=0",
          referer: "https://anima-protocol.com/sign-in/sso-callback",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    const uatSet = cookies.filter((c) => c.startsWith("__client_uat="));
    expect(
      uatSet.some((c) => c.includes("1710000000") && !/Domain=/i.test(c)),
    ).toBe(true);
    expect(
      uatSet.some((c) => /Domain=anima-protocol\.com/i.test(c) && /Max-Age=0/i.test(c)),
    ).toBe(false);
  });

  it("does not follow OAuth Location off Clerk FAPI", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const github = "https://github.com/login/oauth/authorize?client_id=x";
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 307,
        headers: { location: github },
      });
    });
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      appendHeader() {},
      getHeader() {
        return undefined;
      },
      end() {},
    };
    await proxyClerkWithFetch(
      {
        method: "GET",
        url: "/v1/oauth_callback?code=real&state=abc",
        originalUrl: "/api/__clerk/v1/oauth_callback?code=real&state=abc",
        headers: {
          host: "anima-protocol.com",
          origin: "https://anima-protocol.com",
          "x-forwarded-proto": "https",
        },
      } as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      "sk_live_test",
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(307);
    expect(headers.location).toBe(github);
  });
});
