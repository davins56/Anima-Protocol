import { describe, expect, it } from "vitest";
import {
  getClerkProxyHost,
  resolveClerkPublishableKey,
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

describe("resolveClerkPublishableKey", () => {
  const devKey =
    "pk_test_Y2xlcmsuZGV2LmNsZXJrLmFjY291bnRzLmRldiQ";

  it("uses the dev fallback on localhost", () => {
    expect(resolveClerkPublishableKey("localhost:23660", devKey)).toBe(devKey);
  });

  it("uses host-based key for custom domains even when fallback is dev", () => {
    const key = resolveClerkPublishableKey("www.anima-protocol.com", devKey);
    expect(key).not.toBe(devKey);
    expect(key.startsWith("pk_")).toBe(true);
  });
});
