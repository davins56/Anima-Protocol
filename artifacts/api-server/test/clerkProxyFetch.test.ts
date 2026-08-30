import { describe, expect, it, vi } from "vitest";
import {
  buildClerkProxyHeaderValues,
  buildClerkUpstreamHeaders,
  resolveClerkUpstreamPath,
  resolveClerkUpstreamUrl,
} from "../src/middlewares/clerkProxyFetch";

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

  it("falls back to www proxy host when request host headers are missing", () => {
    process.env.CLERK_PUBLISHABLE_KEY =
      "pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA"; // pragma: allowlist secret

    const values = buildClerkProxyHeaderValues(
      { headers: {} },
      "sk_live_test", // pragma: allowlist secret
    );

    expect(values.proxyUrl).toBe(
      "https://www.anima-protocol.com/api/__clerk/",
    );
  });

  it("uses dashboard www proxy headers for localhost pk_live_ dev", () => {
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
      "https://www.anima-protocol.com/api/__clerk/",
    );
    expect(values.origin).toBe("https://www.anima-protocol.com");
  });
});
