import { describe, expect, it } from "vitest";
import { resolveRedirectedApiUrl } from "./apiOrigin";

describe("resolveRedirectedApiUrl", () => {
  it("rebuilds POST /api/storage/uploads after www 301s to the apex root", () => {
    expect(
      resolveRedirectedApiUrl(
        "https://www.anima-protocol.com/api/storage/uploads",
        "https://anima-protocol.com/",
      ),
    ).toBe("https://anima-protocol.com/api/storage/uploads");
  });

  it("keeps a Location that already includes the API path", () => {
    expect(
      resolveRedirectedApiUrl(
        "https://www.anima-protocol.com/api/storage/uploads",
        "https://anima-protocol.com/api/storage/uploads",
      ),
    ).toBe("https://anima-protocol.com/api/storage/uploads");
  });

  it("returns null when Location is missing", () => {
    expect(
      resolveRedirectedApiUrl("https://www.anima-protocol.com/api/storage/uploads", ""),
    ).toBeNull();
  });
});
