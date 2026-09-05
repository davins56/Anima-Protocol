import { describe, expect, it, vi } from "vitest";
import { STORE_COMPANION_CREATE_TIMEOUT_MS } from "./storeTimeouts";
import {
  COMPANION_CREATE_FALLBACK,
  COMPANION_CREATE_TIMEOUT_MESSAGE,
  PENDING_COMPANION_CREATE_MS,
  companionCreateErrorMessage,
  createCompanionRecord,
  isCompanionCreateTimeoutError,
  matchJustCreatedCompanion,
  persistCompanionAvatarUrl,
} from "./createCompanion";

describe("createCompanionRecord", () => {
  it("creates with the extended companion budget", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "char-alyndra",
      name: "Alyndra",
      creation_method: "ai_prompt",
    });

    const created = await createCompanionRecord(
      "Character",
      { name: "Alyndra", creation_method: "ai_prompt", avatar_url: "" },
      { create },
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      { name: "Alyndra", creation_method: "ai_prompt", avatar_url: "" },
      { timeoutMs: STORE_COMPANION_CREATE_TIMEOUT_MS },
    );
    expect(STORE_COMPANION_CREATE_TIMEOUT_MS).toBe(20000);
    expect(created.id).toBe("char-alyndra");
  });

  it("retries once on timeout then succeeds", async () => {
    const timeout = Object.assign(new Error("The server took too long to respond."), {
      code: "timeout",
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ id: "char-2", name: "Alyndra" });
    const list = vi.fn().mockResolvedValue([]);

    const created = await createCompanionRecord(
      "Character",
      { name: "Alyndra" },
      { create, list },
    );

    expect(created.id).toBe("char-2");
    expect(create).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith("-created_date", 50, {
      _bootstrapInternal: true,
    });
  });

  it("returns a just-written row instead of the timeout toast", async () => {
    const timeout = Object.assign(
      new Error("The server took too long to respond. Check your connection or try again in a moment."),
      { code: "timeout" },
    );
    const create = vi.fn().mockRejectedValue(timeout);
    const list = vi.fn().mockResolvedValue([
      {
        id: "char-recovered",
        name: "Alyndra",
        created_date: new Date().toISOString(),
      },
    ]);

    const created = await createCompanionRecord(
      "Character",
      { name: "Alyndra" },
      { create, list },
    );

    expect(created.id).toBe("char-recovered");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retries once on a 503 connection reset", async () => {
    const reset = Object.assign(new Error("Database connection reset"), {
      status: 503,
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce({ id: "anima-3", name: "Alyndra" });
    const list = vi.fn().mockResolvedValue([]);

    const created = await createCompanionRecord(
      "Anima",
      { name: "Alyndra" },
      { create, list },
    );

    expect(created.id).toBe("anima-3");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 401 auth failure", async () => {
    const auth = Object.assign(
      new Error(
        "Not signed in — your session may have expired. Sign out and sign in again, then retry.",
      ),
      { status: 401 },
    );
    const create = vi.fn().mockRejectedValue(auth);
    const list = vi.fn();

    await expect(
      createCompanionRecord("Anima", { name: "Alyndra" }, { create, list }),
    ).rejects.toThrow(/Not signed in/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  it("uploads inline data-URL portraits before POST", async () => {
    const create = vi.fn().mockResolvedValue({ id: "char-4", name: "Alyndra" });
    const persistAvatar = vi.fn().mockResolvedValue("/api/storage/objects/a");

    await createCompanionRecord(
      "Character",
      { name: "Alyndra", avatar_url: "data:image/png;base64,aaa" },
      { create, persistAvatar },
    );

    expect(persistAvatar).toHaveBeenCalledWith("data:image/png;base64,aaa");
    expect(create).toHaveBeenCalledWith(
      { name: "Alyndra", avatar_url: "/api/storage/objects/a" },
      { timeoutMs: STORE_COMPANION_CREATE_TIMEOUT_MS },
    );
  });
});

describe("matchJustCreatedCompanion", () => {
  it("picks the newest matching name inside the pending window", () => {
    const now = Date.parse("2026-09-05T21:00:00.000Z");
    const match = matchJustCreatedCompanion(
      [
        {
          id: "old",
          name: "Alyndra",
          created_date: "2026-09-05T20:00:00.000Z",
        },
        {
          id: "fresh",
          name: "alyndra",
          created_date: "2026-09-05T20:59:30.000Z",
        },
      ],
      "Alyndra",
      now,
    );
    expect(match.id).toBe("fresh");
    expect(PENDING_COMPANION_CREATE_MS).toBe(60000);
  });

  it("ignores other names and rows older than the window", () => {
    const now = Date.parse("2026-09-05T21:00:00.000Z");
    expect(
      matchJustCreatedCompanion(
        [
          {
            id: "aelindra",
            name: "Aelindra",
            created_date: "2026-09-05T20:59:50.000Z",
          },
          {
            id: "stale",
            name: "Alyndra",
            created_date: "2026-09-05T20:50:00.000Z",
          },
        ],
        "Alyndra",
        now,
      ),
    ).toBeNull();
  });
});

describe("companionCreateErrorMessage", () => {
  it("remaps the generic store timeout toast", () => {
    expect(
      companionCreateErrorMessage({
        code: "timeout",
        message:
          "The server took too long to respond. Check your connection or try again in a moment.",
      }),
    ).toBe(COMPANION_CREATE_TIMEOUT_MESSAGE);
    expect(companionCreateErrorMessage({})).toBe(COMPANION_CREATE_FALLBACK);
  });
});

describe("isCompanionCreateTimeoutError", () => {
  it("detects abort and the storeFetch timeout copy", () => {
    expect(isCompanionCreateTimeoutError({ code: "timeout" })).toBe(true);
    expect(isCompanionCreateTimeoutError({ name: "AbortError" })).toBe(true);
    expect(
      isCompanionCreateTimeoutError({
        message: "The server took too long to respond. Check your connection or try again in a moment.",
      }),
    ).toBe(true);
    expect(isCompanionCreateTimeoutError({ message: "nope" })).toBe(false);
  });
});

describe("persistCompanionAvatarUrl", () => {
  it("uploads data URLs and leaves served paths alone", async () => {
    const persist = vi.fn().mockResolvedValue("/api/storage/objects/x");
    expect(await persistCompanionAvatarUrl("/api/storage/objects/x", persist)).toBe(
      "/api/storage/objects/x",
    );
    expect(persist).not.toHaveBeenCalled();
    expect(
      await persistCompanionAvatarUrl("data:image/jpeg;base64,qq", persist),
    ).toBe("/api/storage/objects/x");
  });

  it("drops a data URL when persist fails so create is not blocked", async () => {
    await expect(
      persistCompanionAvatarUrl("data:image/png;base64,aa", async () => {
        throw new Error("upload failed");
      }),
    ).resolves.toBe("");
  });
});
