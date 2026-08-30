import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "./staleChunkRecovery";

describe("isStaleChunkError", () => {
  it("matches the Cloudflare HTML-as-JS MIME failure", () => {
    expect(
      isStaleChunkError(
        new Error(
          `'text/html' is not a valid JavaScript MIME type for module script 'https://anima-protocol.com/assets/EchoKeys-DsgAf3_0.js'.`,
        ),
      ),
    ).toBe(true);
  });

  it("matches failed dynamic import messages from React.lazy", () => {
    expect(
      isStaleChunkError(
        new Error(
          "Failed to fetch dynamically imported module: https://anima-protocol.com/assets/EchoKeys-DsgAf3_0.js",
        ),
      ),
    ).toBe(true);
    expect(
      isStaleChunkError(
        new TypeError("error loading dynamically imported module"),
      ),
    ).toBe(true);
  });

  it("ignores unrelated render errors", () => {
    expect(isStaleChunkError(new Error("kaboom"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});
