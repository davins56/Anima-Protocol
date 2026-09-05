import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHARACTER_PHOTO_LOOKUP_TIMEOUT_MS,
  findCharacterPhoto,
} from "./characterPhoto";

vi.mock("@/api/authBridge", () => ({
  authHeaders: async () => ({ Authorization: "Bearer test" }),
}));

describe("findCharacterPhoto", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it("returns a url on success", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({ url: "https://example.com/alyndra.png" }),
    );
    await expect(findCharacterPhoto("Alyndra")).resolves.toBe(
      "https://example.com/alyndra.png",
    );
    expect(CHARACTER_PHOTO_LOOKUP_TIMEOUT_MS).toBe(8000);
  });

  it("treats a definitive no-match as null", async () => {
    global.fetch = vi.fn(async () => Response.json({ url: null }));
    await expect(findCharacterPhoto("Alyndra")).resolves.toBeNull();
  });

  it("fails open on timeout instead of throwing", async () => {
    global.fetch = vi.fn(async (_url, options = {}) => {
      const err = Object.assign(new Error("The operation was aborted"), {
        name: "TimeoutError",
      });
      if (options.signal) {
        throw options.signal.reason || err;
      }
      throw err;
    });
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controller.abort(
        Object.assign(new Error("The operation was aborted"), {
          name: "TimeoutError",
        }),
      );
      return controller.signal;
    });

    await expect(findCharacterPhoto("Alyndra")).resolves.toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(CHARACTER_PHOTO_LOOKUP_TIMEOUT_MS);
  });

  it("fails open on 502 so missing photos do not toast", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({ error: "image lookup failed", url: null }, { status: 502 }),
    );
    await expect(findCharacterPhoto("Alyndra")).resolves.toBeNull();
  });

  it("still throws on 401 so the caller can ask for sign-in", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );
    await expect(findCharacterPhoto("Alyndra")).rejects.toThrow(/401/);
  });
});
