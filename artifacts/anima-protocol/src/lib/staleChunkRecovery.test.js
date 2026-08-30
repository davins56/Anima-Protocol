import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STALE_CHUNK_RECOVERY_KEY,
  hasAttemptedStaleChunkRecovery,
  isStaleChunkError,
  recoverStaleChunk,
} from "./staleChunkRecovery";

const MIME_ERROR = new Error(
  `'text/html' is not a valid JavaScript MIME type for module script 'https://anima-protocol.com/assets/EchoKeys-DsgAf3_0.js'.`,
);

afterEach(() => {
  try {
    sessionStorage.removeItem(STALE_CHUNK_RECOVERY_KEY);
  } catch {
    /* ignore */
  }
  vi.unstubAllGlobals();
});

describe("isStaleChunkError", () => {
  it("matches the Cloudflare HTML-as-JS MIME failure", () => {
    expect(isStaleChunkError(MIME_ERROR)).toBe(true);
  });

  it("does not treat generic network or CORS dynamic-import failures as stale chunks", () => {
    expect(
      isStaleChunkError(
        new Error(
          "Failed to fetch dynamically imported module: https://anima-protocol.com/assets/EchoKeys-07j-In6E.js",
        ),
      ),
    ).toBe(false);
    expect(
      isStaleChunkError(
        new TypeError("error loading dynamically imported module"),
      ),
    ).toBe(false);
    expect(
      isStaleChunkError(new TypeError("Importing a module script failed.")),
    ).toBe(false);
    expect(isStaleChunkError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStaleChunkError(new Error("kaboom"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe("recoverStaleChunk", () => {
  it("clears caches and reloads only once per session", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });

    expect(hasAttemptedStaleChunkRecovery()).toBe(false);
    expect(await recoverStaleChunk()).toBe(true);
    expect(hasAttemptedStaleChunkRecovery()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    expect(await recoverStaleChunk()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
