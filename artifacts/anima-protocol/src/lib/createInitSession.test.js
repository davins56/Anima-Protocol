import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  INIT_SESSION_TIMEOUT_MESSAGE,
  buildInitSessionPayload,
  createInitChatSession,
  initSessionErrorMessage,
  isStoreTimeoutError,
} from "./createInitSession";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("buildInitSessionPayload", () => {
  it("omits nested messages for a single-character Init", () => {
    const { payload, initialMessages } = buildInitSessionPayload({
      mode: "solo",
      characterId: "char-1",
      character: { id: "char-1", name: "T'Challa", universe: "Marvel" },
      openingScene: "Sitting in my room watching Ralf Smart Infinite Waters on YouTube",
    });

    expect(payload).toMatchObject({
      mode: "solo",
      character_id: "char-1",
      title: "T'Challa",
      opening_scene: "Sitting in my room watching Ralf Smart Infinite Waters on YouTube",
      messages_migrated: true,
    });
    expect(payload).not.toHaveProperty("messages");
    expect(payload).not.toHaveProperty("group_character_ids");
    expect(payload).not.toHaveProperty("shared_memory");
    expect(initialMessages).toEqual([]);
  });

  it("does not wait on auth.me — therapy uses the already-loaded user", () => {
    const { payload } = buildInitSessionPayload({
      mode: "solo",
      character: { id: "anima-1", name: "Serenity", _isAnima: true },
      authUser: { selected_mode: "therapy" },
    });
    expect(payload.therapy_mode).toBe(true);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].character_name).toBe("Serenity");
  });

  it("includes a narrator opening only for group Init", () => {
    const now = new Date("2026-08-30T00:00:00.000Z");
    const { payload } = buildInitSessionPayload({
      mode: "group",
      groupCharacterIds: ["a", "b"],
      groupCharacters: [
        { id: "a", name: "Ikaris", universe: "Eternals" },
        { id: "b", name: "Thena", universe: "Eternals" },
      ],
      now,
    });
    expect(payload.messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        character_name: "Narrator",
        timestamp: now.toISOString(),
      }),
    ]);
  });
});

describe("createInitChatSession", () => {
  it("awaits ChatSession.create and returns the created session", async () => {
    const create = vi.fn().mockResolvedValue({ id: "sess-1", title: "T'Challa" });
    const payload = { mode: "solo", character_id: "char-1", title: "T'Challa" };

    const session = await createInitChatSession(payload, { create });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(payload);
    expect(session).toEqual({ id: "sess-1", title: "T'Challa" });
  });

  it("retries once on abort then surfaces a specific Init error", async () => {
    const timeout = Object.assign(new Error("The server took too long to respond."), {
      code: "timeout",
    });
    const create = vi.fn().mockRejectedValue(timeout);

    await expect(createInitChatSession({ title: "T'Challa" }, { create })).rejects.toMatchObject({
      message: INIT_SESSION_TIMEOUT_MESSAGE,
      code: "timeout",
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(initSessionErrorMessage(timeout)).toBe(INIT_SESSION_TIMEOUT_MESSAGE);
  });

  it("succeeds on the retry after the first create abort", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "AbortError" });
    const create = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ id: "sess-2" });

    const session = await createInitChatSession({ title: "T'Challa" }, { create });

    expect(session).toEqual({ id: "sess-2" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-timeout store failure", async () => {
    const create = vi.fn().mockRejectedValue(new Error("schema is missing"));
    await expect(createInitChatSession({ title: "X" }, { create })).rejects.toThrow(
      /schema is missing/,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("Chat Init wiring", () => {
  it("awaits createInitChatSession and does not rewrite messages after create", () => {
    const chat = readFileSync(join(srcRoot, "pages/Chat.jsx"), "utf8");
    expect(chat).toContain("await createInitChatSession(payload)");
    expect(chat).not.toMatch(
      /createInitChatSession\(payload\);[\s\S]{0,400}ChatSession\.update\([\s\S]*messages/,
    );
  });
});

describe("isStoreTimeoutError", () => {
  it("recognizes abort, TimeoutError, and code=timeout", () => {
    expect(isStoreTimeoutError({ code: "timeout" })).toBe(true);
    expect(isStoreTimeoutError({ name: "TimeoutError" })).toBe(true);
    expect(isStoreTimeoutError({ name: "AbortError" })).toBe(true);
    expect(isStoreTimeoutError({ message: "nope" })).toBe(false);
  });
});
