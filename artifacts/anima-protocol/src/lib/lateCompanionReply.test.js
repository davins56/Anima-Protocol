import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_DROPPED_STATUS,
  dropLateTurnPlaceholder,
  GENERIC_COMPANION_COULD_NOT_REPLY,
  LATE_REPLY_AFTER_ABORT_MS,
  LATE_REPLY_POLL_MS,
  createLateReplyWatch,
  isBrowserChatDeadlineError,
  isCompanionStillTypingError,
  isConnectionDroppedError,
  dropTurnPlaceholder,
  lateReplyRecoveryPlan,
  lateReplyWatchSupersededBy,
  lateTurnFailedWithoutReply,
  mergeLateReplyIntoMessages,
  paintLateCompanionReply,
  pollLateCompanionReply,
} from "./lateCompanionReply.js";

describe("late reply poll window", () => {
  it("covers the local queue wait plus the generation cap when the turn may still be running", () => {
    expect(LATE_REPLY_POLL_MS).toBe(300_000);
  });

  it("checks only briefly after the browser already aborted, without blocking Retry", () => {
    expect(LATE_REPLY_AFTER_ABORT_MS).toBe(45_000);
    expect(LATE_REPLY_AFTER_ABORT_MS).toBeLessThanOrEqual(60_000);
    const timeout = new Error("The companion took too long to reply. Please try again.");
    timeout.code = "chat_stream_timeout";
    expect(isBrowserChatDeadlineError(timeout)).toBe(true);
    expect(lateReplyRecoveryPlan(timeout)).toEqual({
      showRetryImmediately: true,
      backgroundMs: LATE_REPLY_AFTER_ABORT_MS,
      blockingMs: 0,
    });
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    expect(lateReplyRecoveryPlan(aborted).showRetryImmediately).toBe(true);
    const named = new Error("timed out");
    named.name = "TimeoutError";
    expect(isBrowserChatDeadlineError(named)).toBe(true);
    const abortCode = new Error("aborted");
    abortCode.code = "ABORT_ERR";
    expect(isBrowserChatDeadlineError(abortCode)).toBe(true);

    const inflight = new Error("This chat turn is already being processed.");
    inflight.code = "turn_in_flight";
    inflight.status = 409;
    expect(isBrowserChatDeadlineError(inflight)).toBe(false);
    expect(lateReplyRecoveryPlan(inflight)).toEqual({
      showRetryImmediately: false,
      backgroundMs: 0,
      blockingMs: LATE_REPLY_POLL_MS,
    });
    expect(isBrowserChatDeadlineError(new TypeError("Failed to fetch"))).toBe(false);
    expect(
      lateReplyRecoveryPlan(new Error(GENERIC_COMPANION_COULD_NOT_REPLY)).showRetryImmediately,
    ).toBe(false);
  });
});

describe("isCompanionStillTypingError", () => {
  it("treats a slow stream and an in-flight turn as still typing", () => {
    const timeout = new Error("The companion took too long to reply. Please try again.");
    timeout.code = "chat_stream_timeout";
    expect(isCompanionStillTypingError(timeout)).toBe(true);
    const inflight = new Error("This chat turn is already being processed.");
    inflight.code = "turn_in_flight";
    inflight.status = 409;
    expect(isCompanionStillTypingError(inflight)).toBe(true);
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    expect(isCompanionStillTypingError(aborted)).toBe(true);
    expect(
      isCompanionStillTypingError(new Error(GENERIC_COMPANION_COULD_NOT_REPLY)),
    ).toBe(true);
  });

  it("treats a network TypeError as a dropped connection, not an engine bug", () => {
    expect(isConnectionDroppedError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isConnectionDroppedError(new TypeError("Load failed"))).toBe(true);
    expect(
      isConnectionDroppedError(
        new TypeError("NetworkError when attempting to fetch resource."),
      ),
    ).toBe(true);
    expect(isConnectionDroppedError(new TypeError("H is not a function"))).toBe(false);
    expect(isCompanionStillTypingError(new TypeError("Failed to fetch"))).toBe(false);
    const busy = new Error(
      "The companion is still finishing the last reply. Wait a moment, then try again.",
    );
    busy.code = "conversation_busy";
    busy.status = 409;
    expect(isCompanionStillTypingError(busy)).toBe(false);
    expect(CONNECTION_DROPPED_STATUS).toMatch(/checking for her reply/i);
    expect(lateTurnFailedWithoutReply({ persistence_status: "failed" })).toBe(true);
    expect(
      lateTurnFailedWithoutReply({
        persistence_status: "failed",
        assistant_content: "I stayed.",
      }),
    ).toBe(false);
    expect(lateTurnFailedWithoutReply({ persistence_status: "pending" })).toBe(false);
  });

  it("does not hide a real auth failure", () => {
    const err = new Error("Not signed in — your session may have expired.");
    err.status = 401;
    expect(isCompanionStillTypingError(err)).toBe(false);
  });
});

describe("dropTurnPlaceholder", () => {
  it("removes only the placeholder for that turn", () => {
    const messages = [
      { role: "user", content: "hi", turn_id: "turn_a" },
      { role: "assistant", content: "...", character_name: "__typing__", turn_id: "turn_a" },
      { role: "assistant", content: "...", character_name: "__thinking__", turn_id: "turn_b" },
      { role: "assistant", content: "still here", turn_id: "turn_a" },
    ];
    expect(dropTurnPlaceholder(messages, "turn_a").map((message) => message.turn_id)).toEqual([
      "turn_a",
      "turn_b",
      "turn_a",
    ]);
    expect(dropTurnPlaceholder(messages, "turn_a")[1].character_name).toBe("__thinking__");
  });
});

describe("mergeLateReplyIntoMessages", () => {
  it("keeps one user line and one assistant line for the turn", () => {
    const first = mergeLateReplyIntoMessages(
      [
        { id: "older", role: "assistant", content: "Earlier." },
        { id: "turn_1:user", role: "user", content: "Hello" },
        { role: "assistant", content: "...", character_name: "__typing__" },
      ],
      {
        turnId: "turn_1",
        userContent: "Hello",
        assistantContent: "I am happy you stayed.",
        characterName: "Aria",
      },
    );
    const again = mergeLateReplyIntoMessages(first, {
      turnId: "turn_1",
      userContent: "Hello",
      assistantContent: "I am happy you stayed.",
      characterName: "Aria",
    });
    expect(again.map((message) => message.id)).toEqual([
      "older",
      "turn_1:user",
      "turn_1:assistant",
    ]);
    expect(again.filter((message) => message.character_name === "__typing__")).toEqual([]);
  });

  it("marks a late cut-off reply so Retry can replace it", () => {
    const merged = mergeLateReplyIntoMessages([], {
      turnId: "turn_cut",
      userContent: "My name is Mira.",
      assistantContent: "You came back.",
      characterName: "Aria",
      reply_interrupted: true,
      cut_off: true,
    });
    expect(merged[1]).toMatchObject({
      role: "assistant",
      content: "You came back.",
      reply_interrupted: true,
      cut_off: true,
    });
  });

  it("inserts the late reply under its own user message when newer turns exist", () => {
    const merged = mergeLateReplyIntoMessages(
      [
        { id: "turn_1:user", role: "user", content: "First question", turn_id: "turn_1" },
        { id: "turn_2:user", role: "user", content: "Newer question", turn_id: "turn_2" },
        {
          id: "turn_2:assistant",
          role: "assistant",
          content: "Newer answer",
          turn_id: "turn_2",
        },
      ],
      {
        turnId: "turn_1",
        userContent: "First question",
        assistantContent: "Answer to the first question",
        characterName: "Aria",
      },
    );
    expect(merged.map((message) => message.id)).toEqual([
      "turn_1:user",
      "turn_1:assistant",
      "turn_2:user",
      "turn_2:assistant",
    ]);
    expect(merged[1].content).toBe("Answer to the first question");
  });

  it("leaves a newer turn's typing bubble in place", () => {
    const merged = mergeLateReplyIntoMessages(
      [
        { id: "turn_1:user", role: "user", content: "Hello", turn_id: "turn_1" },
        {
          role: "assistant",
          content: "...",
          character_name: "__typing__",
          turn_id: "turn_2",
          late_turn_id: "turn_2",
        },
      ],
      {
        turnId: "turn_1",
        userContent: "Hello",
        assistantContent: "I stayed.",
        characterName: "Aria",
      },
    );
    expect(merged.map((message) => message.turn_id)).toEqual(["turn_1", "turn_1", "turn_2"]);
    expect(merged[1].content).toBe("I stayed.");
    expect(merged[2].character_name).toBe("__typing__");
  });
});

describe("paintLateCompanionReply", () => {
  const saved = {
    turnId: "turn_1",
    userContent: "Hello",
    assistantContent: "I stayed.",
    characterName: "Aria",
  };

  it("paints the saved reply once under its user line", () => {
    const first = paintLateCompanionReply(
      [
        { id: "turn_1:user", role: "user", content: "Hello", turn_id: "turn_1" },
        { role: "assistant", content: "...", character_name: "__typing__", turn_id: "turn_1" },
      ],
      saved,
    );
    const again = paintLateCompanionReply(first.messages, saved);
    expect(first.painted).toBe(true);
    expect(again.painted).toBe(true);
    expect(again.messages.map((message) => message.id)).toEqual([
      "turn_1:user",
      "turn_1:assistant",
    ]);
  });

  it("does not add the late reply once a retry or edit has started", () => {
    const messages = [
      { id: "turn_1:user", role: "user", content: "Hello", turn_id: "turn_1" },
      { id: "turn_2:user", role: "user", content: "Hello", turn_id: "turn_2" },
      {
        role: "assistant",
        content: "...",
        character_name: "__typing__",
        turn_id: "turn_2",
      },
    ];
    const result = paintLateCompanionReply(messages, saved, { superseded: true });
    expect(result.painted).toBe(false);
    expect(result.messages.some((message) => message.content === "I stayed.")).toBe(false);
    expect(result.messages.map((message) => message.turn_id)).toEqual([
      "turn_1",
      "turn_2",
      "turn_2",
    ]);
  });

  it("still paints when a different later question is already on the thread", () => {
    const result = paintLateCompanionReply(
      [
        { id: "turn_1:user", role: "user", content: "Hello", turn_id: "turn_1" },
        { id: "turn_2:user", role: "user", content: "Something else", turn_id: "turn_2" },
        {
          id: "turn_2:assistant",
          role: "assistant",
          content: "Later answer",
          turn_id: "turn_2",
        },
      ],
      saved,
    );
    expect(result.painted).toBe(true);
    expect(result.messages.map((message) => message.id)).toEqual([
      "turn_1:user",
      "turn_1:assistant",
      "turn_2:user",
      "turn_2:assistant",
    ]);
  });
});

describe("late reply watch", () => {
  const watch = createLateReplyWatch({
    turnId: "turn_1",
    sessionId: "sess",
    userContent: "Hello",
  });

  it("treats retry, edit, and the same line as a new attempt", () => {
    expect(watch.superseded).toBe(false);
    expect(
      lateReplyWatchSupersededBy(watch, {
        sessionId: "sess",
        content: "Hello",
        replyAction: null,
      }),
    ).toBe(true);
    expect(
      lateReplyWatchSupersededBy(watch, {
        sessionId: "sess",
        content: "Hello",
        replyAction: "retry",
      }),
    ).toBe(true);
    expect(
      lateReplyWatchSupersededBy(watch, {
        sessionId: "sess",
        content: "Rewritten",
        replyAction: "edit",
      }),
    ).toBe(true);
  });

  it("keeps watching when the next line is a different question", () => {
    expect(
      lateReplyWatchSupersededBy(watch, {
        sessionId: "sess",
        content: "Something else",
        replyAction: null,
      }),
    ).toBe(false);
    expect(
      lateReplyWatchSupersededBy(watch, {
        sessionId: "other",
        content: "Hello",
        replyAction: "retry",
      }),
    ).toBe(false);
  });
});

describe("chat page shows Retry before the background check", () => {
  const chat = readFileSync(path.join(process.cwd(), "src/pages/Chat.jsx"), "utf8");

  it("toasts immediately after the browser abort and does not block on that poll", () => {
    const start = chat.indexOf("if (recovery.showRetryImmediately)");
    expect(start).toBeGreaterThan(-1);
    const elseAt = chat.indexOf("} else {", start);
    expect(elseAt).toBeGreaterThan(start);
    const immediate = chat.slice(start, elseAt);
    const blocking = chat.slice(elseAt, elseAt + 1200);
    expect(immediate).toContain("toastCouldNotReply()");
    const toastAt = immediate.indexOf("toastCouldNotReply()");
    const voidAt = immediate.indexOf("void (async () => {");
    const awaitAt = immediate.indexOf("await pollLateCompanionReply");
    expect(toastAt).toBeGreaterThan(-1);
    expect(voidAt).toBeGreaterThan(toastAt);
    expect(awaitAt).toBeGreaterThan(voidAt);
    expect(immediate).toContain("timeoutMs: recovery.backgroundMs");
    expect(blocking).toContain("await pollLateCompanionReply");
    expect(blocking).toContain("timeoutMs: LATE_REPLY_POLL_MS");
    expect(chat).toContain("lateReplyWatchSupersededBy");
    expect(chat).toContain("paintLateCompanionReply");
    expect(chat).toContain('const omitUserRow = isContinue || replyAction === "retry"');
  });
});

describe("cut-off replies skip client mining", () => {
  const chat = readFileSync(path.join(process.cwd(), "src/pages/Chat.jsx"), "utf8");

  it("does not parse reply image tags or event rows when the server marked the reply cut off", () => {
    const start = chat.indexOf("const wantsImage = replyCutOff.reply_interrupted");
    expect(start).toBeGreaterThan(-1);
    const block = chat.slice(start, start + 5000);
    expect(block.startsWith(
      "const wantsImage = replyCutOff.reply_interrupted\n        ? userRequestedImage(content)\n        : parseImagePrompts(result).length > 0 || userRequestedImage(content);",
    )).toBe(true);
    expect(block).toContain('replyText: replyCutOff.reply_interrupted ? "" : result');
    expect(block).toContain(
      "while (!replyCutOff.reply_interrupted && (match = tagScanner.exec(result))",
    );
    const moodAt = chat.indexOf("} else if (!replyCutOff.reply_interrupted)", start);
    expect(moodAt).toBeGreaterThan(start);
  });
});

describe("pollLateCompanionReply", () => {
  it("returns the saved reply once assistant text arrives", async () => {
    const fetchTurn = vi
      .fn()
      .mockResolvedValueOnce({ persistence_status: "pending", assistant_content: "" })
      .mockResolvedValueOnce({
        persistence_status: "committed",
        assistant_content: "I am happy you stayed.",
        companion_affect: { primary: "happy" },
      });
    const result = await pollLateCompanionReply({
      fetchTurn,
      timeoutMs: 5_000,
      intervalMs: 1,
      sleep: async () => {},
    });
    expect(result.assistant_content).toBe("I am happy you stayed.");
    expect(fetchTurn).toHaveBeenCalledTimes(2);
  });

  it("stops immediately when the turn was never saved", async () => {
    const missing = new Error("Turn not found");
    missing.status = 404;
    const fetchTurn = vi.fn().mockRejectedValue(missing);
    const result = await pollLateCompanionReply({
      fetchTurn,
      timeoutMs: 5_000,
      intervalMs: 1_000,
      sleep: async () => {
        throw new Error("should not wait");
      },
    });
    expect(result.persistence_status).toBe("failed");
    expect(String(result.assistant_content || "")).toBe("");
    expect(fetchTurn).toHaveBeenCalledTimes(1);
  });
});

describe("dropLateTurnPlaceholder", () => {
  it("removes only the bubble waiting on that turn", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "...", character_name: "__typing__", late_turn_id: "t1" },
      { role: "assistant", content: "...", character_name: "__thinking__" },
    ];
    expect(dropLateTurnPlaceholder(messages, "t1")).toEqual([messages[0], messages[2]]);
    expect(dropLateTurnPlaceholder(null, "t1")).toEqual([]);
  });
});
