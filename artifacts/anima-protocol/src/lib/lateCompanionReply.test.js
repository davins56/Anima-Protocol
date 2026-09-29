import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_DROPPED_STATUS,
  dropLateTurnPlaceholder,
  GENERIC_COMPANION_COULD_NOT_REPLY,
  LATE_REPLY_POLL_MS,
  isCompanionStillTypingError,
  isConnectionDroppedError,
  dropTurnPlaceholder,
  lateTurnFailedWithoutReply,
  mergeLateReplyIntoMessages,
  pollLateCompanionReply,
} from "./lateCompanionReply.js";

describe("late reply poll window", () => {
  it("covers the local queue wait plus the generation cap", () => {
    expect(LATE_REPLY_POLL_MS).toBe(300_000);
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
