import { describe, expect, it, vi } from "vitest";
import {
  GENERIC_COMPANION_COULD_NOT_REPLY,
  isCompanionStillTypingError,
  mergeLateReplyIntoMessages,
  pollLateCompanionReply,
} from "./lateCompanionReply.js";

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

  it("does not hide a real auth failure", () => {
    const err = new Error("Not signed in — your session may have expired.");
    err.status = 401;
    expect(isCompanionStillTypingError(err)).toBe(false);
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
});
