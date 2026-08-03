import { describe, expect, it } from "vitest";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  canonicalClerkProxyHeaderHost,
  getClerkAuthHostCandidates,
  getClerkProxyHost,
  resolveClerkPublishableKey,
  resolveRuntimePublishableKey,
} from "../src/middlewares/clerkProxyMiddleware";

describe("getClerkProxyHost", () => {
  it("prefers x-forwarded-host over backend host", () => {
    expect(
      getClerkProxyHost({
        headers: {
          "x-forwarded-host": "www.anima-protocol.com",
          host: "anima-protocol.replit.app",
        },
      }),
    ).toBe("www.anima-protocol.com");
  });

  it("falls back to Origin when forwarded host is absent", () => {
    expect(
      getClerkProxyHost({
        headers: {
          host: "anima-protocol.replit.app",
          origin: "https://www.anima-protocol.com",
        },
      }),
    ).toBe("www.anima-protocol.com");
  });

  it("uses x-anima-public-host when it matches Origin", () => {
    expect(
      getClerkProxyHost({
        headers: {
          host: "anima-protocol.replit.app",
          origin: "https://www.anima-protocol.com",
          "x-anima-public-host": "www.anima-protocol.com",
        },
      }),
    ).toBe("www.anima-protocol.com");
  });

  it("trusts x-anima-public-host for known production domains without Origin", () => {
    expect(
      getClerkProxyHost({
        headers: {
          host: "anima-protocol.replit.app",
          "x-anima-public-host": "anima-protocol.com",
        },
      }),
    ).toBe("anima-protocol.com");
  });

  it("ignores x-anima-public-host when it does not match Origin", () => {
    expect(
      getClerkProxyHost({
        headers: {
          host: "anima-protocol.replit.app",
          origin: "https://www.anima-protocol.com",
          "x-anima-public-host": "evil.example.com",
        },
      }),
    ).toBe("www.anima-protocol.com");
  });

  it("prefers Origin over bare replit backend host", () => {
    expect(
      getClerkProxyHost({
        headers: {
          host: "anima-protocol.replit.app",
          referer: "https://anima-protocol.com/characters",
        },
      }),
    ).toBe("anima-protocol.com");
  });
});

describe("getClerkAuthHostCandidates", () => {
  it("includes www and apex variants for known hosts", () => {
    const hosts = getClerkAuthHostCandidates({
      headers: {
        host: "anima-protocol.replit.app",
        "x-anima-public-host": "www.anima-protocol.com",
      },
    });
    expect(hosts).toContain("www.anima-protocol.com");
    expect(hosts).toContain("anima-protocol.com");
  });
});

describe("canonicalClerkProxyHeaderHost", () => {
  it("normalizes apex to www for Clerk proxy headers", () => {
    expect(canonicalClerkProxyHeaderHost("anima-protocol.com")).toBe(
      "www.anima-protocol.com",
    );
    expect(canonicalClerkProxyHeaderHost("www.anima-protocol.com")).toBe(
      "www.anima-protocol.com",
    );
  });

  it("leaves unrelated hosts unchanged", () => {
    expect(canonicalClerkProxyHeaderHost("preview.vercel.app")).toBe(
      "preview.vercel.app",
    );
  });
});

describe("resolveClerkPublishableKey", () => {
  const devKey =
    "pk_test_Y2xlcmsuZGV2LmNsZXJrLmFjY291bnRzLmRldiQ";

  it("uses the dev fallback on localhost", () => {
    expect(resolveClerkPublishableKey("localhost:23660", devKey)).toBe(devKey);
  });

  it("uses dev fallback on custom domains when env is dev (no Clerk proxy on client)", () => {
    expect(resolveClerkPublishableKey("www.anima-protocol.com", devKey)).toBe(
      devKey,
    );
  });

  it("keeps the custom-domain pk_live_ key on www (not clerk.www.*)", () => {
    const prodKey = publishableKeyFromHost("anima-protocol.com");
    expect(resolveClerkPublishableKey("www.anima-protocol.com", prodKey)).toBe(
      prodKey,
    );
    expect(resolveClerkPublishableKey("anima-protocol.com", undefined)).toBe(
      prodKey,
    );
  });

  it("uses the live fallback on localhost for local dev proxy", () => {
    const prodKey = publishableKeyFromHost("anima-protocol.com");
    expect(resolveClerkPublishableKey("127.0.0.1:23660", prodKey)).toBe(
      prodKey,
    );
  });
});

describe("resolveRuntimePublishableKey", () => {
  const apexKey = publishableKeyFromHost("anima-protocol.com");

  it("uses a valid CLERK_PUBLISHABLE_KEY from the environment", () => {
    const prev = process.env.CLERK_PUBLISHABLE_KEY;
    process.env.CLERK_PUBLISHABLE_KEY = apexKey;
    try {
      expect(
        resolveRuntimePublishableKey({
          headers: { host: "www.anima-protocol.com" },
        }),
      ).toBe(apexKey);
    } finally {
      if (prev === undefined) delete process.env.CLERK_PUBLISHABLE_KEY;
      else process.env.CLERK_PUBLISHABLE_KEY = prev;
    }
  });

  it("derives the custom-domain key when env publishable key is invalid", () => {
    const prev = process.env.CLERK_PUBLISHABLE_KEY;
    process.env.CLERK_PUBLISHABLE_KEY = "not-a-valid-clerk-key";
    try {
      expect(
        resolveRuntimePublishableKey({
          headers: { host: "www.anima-protocol.com" },
        }),
      ).toBe(apexKey);
    } finally {
      if (prev === undefined) delete process.env.CLERK_PUBLISHABLE_KEY;
      else process.env.CLERK_PUBLISHABLE_KEY = prev;
    }
  });
});

