import { describe, expect, it, vi } from "vitest";
import {
  buildClerkProxyHeaderValues,
  buildClerkUpstreamHeaders,
  clerkFrontendApiBaseFromPublishableKey,
  forwardedRequestProto,
  proxyClerkWithFetch,
  resolveClerkNpmRedirectUrl,
  resolveClerkUpstreamPath,
  resolveClerkUpstreamUrl,
  rewriteClerkProxyLocation,
  rewriteClerkProxySetCookie,
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
    expect(headers.get("Host")).toBeNull();
    expect(headers.get("Origin")).toBe("https://www.anima-protocol.com");
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
    expect(headers.get("Clerk-Secret-Key")).toBeNull();
    expect(headers.get("Origin")).toBe("https://anima-protocol.com");
  });

  it("rewrites CNAME-cloaked Clerk cookies onto the app origin", () => {
    expect(
      rewriteClerkProxySetCookie(
        "__client=abc; Path=/; Domain=clerk.anima-protocol.com; HttpOnly; Secure; SameSite=Lax",
        "anima-protocol.com",
      ),
    ).toBe("__client=abc; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(
      rewriteClerkProxySetCookie(
        "__client_uat=1; Path=/; Domain=anima-protocol.com; Secure; SameSite=Lax",
        "anima-protocol.com",
      ),
    ).toBe(
      "__client_uat=1; Path=/; Domain=anima-protocol.com; Secure; SameSite=Lax",
    );
    expect(
      rewriteClerkProxySetCookie(
        "__cf_bm=x; Path=/; Domain=.clerkprod-cloudflare.net; HttpOnly; Secure; SameSite=None",
        "anima-protocol.com",
      ),
    ).toBeNull();
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
    expect(cookies.some((c) => c.startsWith("__client=tok") && !/Domain=/i.test(c))).toBe(
      true,
    );
    expect(
      cookies.some((c) =>
        c.includes("__client_uat=1") && c.includes("Domain=anima-protocol.com"),
      ),
    ).toBe(true);
  });

  it("follows Clerk CDN 307 for unversioned clerk-js and returns 200 JS", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = CUSTOM_DOMAIN_KEY;
    const unversioned =
      "https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js";
    const versioned =
      "https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6.31.0/dist/clerk.browser.js";
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(307);
    expect(headers.location).toBe(github);
  });
});
