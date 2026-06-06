import { describe, expect, it } from "vitest";
import { getClerkProxyHost } from "../src/middlewares/clerkProxyMiddleware";

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
});
