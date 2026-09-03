import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  INIT_SESSION_MISSING_ID_MESSAGE,
  INIT_SESSION_TIMEOUT_MESSAGE,
  applyIdentityFallback,
  buildInitSessionPayload,
  characterUpsertIdMap,
  createdSessionId,
  createInitChatSession,
  initSessionErrorMessage,
  isStoreTimeoutError,
  isUsableSessionId,
  matchCharacterByIdentity,
  remapSelectedCharacterIds,
  requireCreatedSession,
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

  it("does not wait on /messages/replace before returning a group Init session", async () => {
    let persistResolve;
    const persistPromise = new Promise((resolve) => {
      persistResolve = resolve;
    });
    const persistMessages = vi.fn(() => persistPromise);
    const create = vi.fn().mockResolvedValue({ id: "sess-group", title: "A, B" });
    const payload = {
      mode: "group",
      title: "A, B",
      messages: [{ role: "assistant", character_name: "Narrator", content: "The stage is set." }],
    };

    const session = await createInitChatSession(payload, { create, persistMessages });

    expect(create).toHaveBeenCalledWith({ mode: "group", title: "A, B" });
    expect(session).toEqual({
      id: "sess-group",
      title: "A, B",
      messages: payload.messages,
    });
    expect(persistMessages).toHaveBeenCalledWith("sess-group", payload.messages);
    persistResolve([{ id: "m1" }]);
    await persistPromise;
  });

  it("does not retry a non-timeout store failure", async () => {
    const create = vi.fn().mockRejectedValue(new Error("schema is missing"));
    await expect(createInitChatSession({ title: "X" }, { create })).rejects.toThrow(
      /schema is missing/,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects a create body without a usable id so Init cannot open /chat/undefined", async () => {
    const create = vi.fn().mockResolvedValue({ title: "T'Challa" });
    await expect(createInitChatSession({ title: "T'Challa" }, { create })).rejects.toMatchObject({
      message: INIT_SESSION_MISSING_ID_MESSAGE,
      code: "missing_session_id",
    });
  });

  it("accepts an id on a wrapped create body", async () => {
    const create = vi.fn().mockResolvedValue({ entityId: "sess-wrapped", title: "T'Challa" });
    const session = await createInitChatSession({ title: "T'Challa" }, { create });
    expect(session.id).toBe("sess-wrapped");
  });
});

describe("createdSessionId", () => {
  it("rejects undefined/null/empty and unwraps common store shapes", () => {
    expect(isUsableSessionId("sess-1")).toBe(true);
    expect(isUsableSessionId("undefined")).toBe(false);
    expect(isUsableSessionId(undefined)).toBe(false);
    expect(createdSessionId({ id: "a" })).toBe("a");
    expect(createdSessionId({ entityId: "b" })).toBe("b");
    expect(createdSessionId([{ id: "c" }])).toBe("c");
    expect(createdSessionId({ title: "Nope" })).toBeNull();
    expect(requireCreatedSession({ id: "d" }).id).toBe("d");
    expect(() => requireCreatedSession({})).toThrow(INIT_SESSION_MISSING_ID_MESSAGE);
  });
});

describe("remapSelectedCharacterIds", () => {
  it("maps a bundled seed id onto the store id returned by upsert", () => {
    expect(
      remapSelectedCharacterIds(
        ["seed_marvel-tchalla"],
        [{ id: "seed_marvel-tchalla", name: "T'Challa", universe: "MCU" }],
        [{ id: "char_store_1", name: "T'Challa", universe: "MCU" }],
      ),
    ).toEqual(["char_store_1"]);
  });

  it("keeps the picker id when upsert is idempotent on that id", () => {
    expect(
      remapSelectedCharacterIds(
        ["seed_marvel-tchalla"],
        [{ id: "seed_marvel-tchalla", name: "T'Challa", universe: "MCU" }],
        [{ id: "seed_marvel-tchalla", name: "T'Challa", universe: "MCU" }],
      ),
    ).toEqual(["seed_marvel-tchalla"]);
  });

  it("prefers an explicit idMap for solo and group picker ids", () => {
    const bundled = [
      { id: "seed_a", name: "Tony Stark", universe: "MCU" },
      { id: "seed_b", name: "Steve Rogers", universe: "MCU" },
    ];
    const items = [
      { id: "pg_1", name: "Tony Stark", universe: "MCU" },
      { id: "pg_2", name: "Steve Rogers", universe: "MCU" },
    ];
    const idMap = characterUpsertIdMap(bundled, items);
    expect(idMap).toEqual({ seed_a: "pg_1", seed_b: "pg_2" });
    expect(remapSelectedCharacterIds(["seed_a"], bundled, items, idMap)).toEqual([
      "pg_1",
    ]);
    expect(
      remapSelectedCharacterIds(["seed_a", "seed_b"], bundled, items, idMap),
    ).toEqual(["pg_1", "pg_2"]);
  });
});

describe("applyIdentityFallback", () => {
  it("replaces a stale remapped seed id with the universe+name store id", () => {
    const bundled = [
      { id: "seed_protocol-serenity", name: "Serenity", universe: "Protocol" },
    ];
    const items = [
      { id: "char_store_9", name: "Serenity", universe: "Protocol" },
    ];
    expect(
      applyIdentityFallback(
        ["seed_protocol-serenity"],
        ["seed_protocol-serenity"],
        bundled,
        items,
      ),
    ).toEqual(["char_store_9"]);
    expect(matchCharacterByIdentity(bundled[0], items)?.id).toBe("char_store_9");
  });

  it("keeps the seed id when no identity match exists so Init can still create", () => {
    expect(
      applyIdentityFallback(
        ["seed_protocol-serenity"],
        ["seed_protocol-serenity"],
        [{ id: "seed_protocol-serenity", name: "Serenity", universe: "Protocol" }],
        [{ id: "char_other", name: "Tony Stark", universe: "MCU" }],
      ),
    ).toEqual(["seed_protocol-serenity"]);
  });
});

describe("Chat Init wiring", () => {
  it("awaits createInitChatSession and does not rewrite messages after create", () => {
    const chat = readFileSync(join(srcRoot, "pages/Chat.jsx"), "utf8");
    expect(chat).toContain("await createInitChatSession(payload)");
    expect(chat).toContain("rememberCreatedSession(primedSession)");
    expect(chat).toContain("navigate(`/chat/${primedSession.id}`, { state: { primedSession } })");
    expect(chat).toContain("justCreatedSessionIdRef.current = primedSession.id");
    expect(chat).not.toMatch(/await loadSessions\(\)/);
    expect(chat).not.toMatch(
      /createInitChatSession\(payload\);[\s\S]{0,400}ChatSession\.update\([\s\S]*messages/,
    );
  });

  it("prefers the modal-passed character and does not require an id match to skip filter", () => {
    const chat = readFileSync(join(srcRoot, "pages/Chat.jsx"), "utf8");
    expect(chat).toContain('m === "solo" && character');
    expect(chat).toContain("? character");
    expect(chat).not.toContain("character.id === character_id");
  });

  it("keeps one Chat instance for /chat and /chat/:id", () => {
    const protocol = readFileSync(join(srcRoot, "ProtocolApp.jsx"), "utf8");
    const chatPaths = [...protocol.matchAll(/path="(\/chat[^"]*)"/g)].map((m) => m[1]);
    expect(chatPaths).toEqual(["/chat/:sessionId?"]);
    expect(protocol).not.toMatch(/pages\/NewChat/);
    expect(protocol).not.toMatch(/const NewChat = lazy/);
  });

  it("Story Chooser creates via createInitChatSession so /messages/replace cannot block", () => {
    const chooser = readFileSync(
      join(srcRoot, "components/stories/StoryCharacterChooser.jsx"),
      "utf8",
    );
    expect(chooser).toContain("createInitChatSession(");
    expect(chooser).toContain("buildInitSessionPayload(");
    expect(chooser).not.toMatch(/ChatSession\.create\s*\(/);
    expect(chooser).not.toMatch(/await\s+base44\.messages\.replace/);
  });

  it("chooser handoff remembers the primed session and navigates with location.state", () => {
    const modal = readFileSync(
      join(srcRoot, "components/chat/NewSessionModal.jsx"),
      "utf8",
    );
    expect(modal).toContain("rememberCreatedSession(session)");
    expect(modal).toContain(
      "navigate(`/chat/${session.id}`, { state: { primedSession: session } })",
    );
    expect(modal).toContain("isUsableSessionId(session?.id)");
    expect(modal).toContain("timeoutMs: STORE_SESSION_CREATE_TIMEOUT_MS");
    expect(modal).toContain("applyIdentityFallback(");
    expect(modal).not.toContain("Could not match the selected starter");
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
