import { describe, expect, it } from "vitest";
import {
  lastReplyActionIndexes,
  planEditResend,
  planRetryReply,
  replyActionsAreLocked,
} from "./chatReplyActions";

const thread = [
  { role: "user", content: "hello" },
  { role: "assistant", content: "hi there" },
  { role: "user", content: "tell me a story" },
  { role: "assistant", content: "once upon a time" },
];

describe("replyActionsAreLocked", () => {
  it("stays open when nothing is in flight or waiting", () => {
    expect(
      replyActionsAreLocked({
        answering: false,
        turnLocked: false,
        heldOutgoing: false,
        restoredDraft: false,
      }),
    ).toBe(false);
  });

  it("locks while she is answering, a follow-up is queued, or a draft was restored", () => {
    expect(replyActionsAreLocked({ answering: true })).toBe(true);
    expect(replyActionsAreLocked({ turnLocked: true })).toBe(true);
    expect(replyActionsAreLocked({ heldOutgoing: true })).toBe(true);
    expect(replyActionsAreLocked({ restoredDraft: true })).toBe(true);
  });
});

describe("planRetryReply", () => {
  it("keeps his user line and drops only her reply and anything after it", () => {
    const plan = planRetryReply(
      [...thread, { role: "user", content: "go on" }],
      3,
    );
    expect(plan.ok).toBe(true);
    expect(plan.userContent).toBe("tell me a story");
    expect(plan.kept.map((message) => message.content)).toEqual([
      "hello",
      "hi there",
      "tell me a story",
    ]);
    expect(plan.kept.some((message) => message.role === "user" && message.content === "tell me a story")).toBe(
      true,
    );
    expect(plan.kept.some((message) => message.content === "once upon a time")).toBe(false);
  });

  it("does not invent a user turn when her reply is already gone", () => {
    const plan = planRetryReply(thread.slice(0, 3), 3);
    expect(plan.ok).toBe(true);
    expect(plan.userContent).toBe("tell me a story");
    expect(plan.kept).toHaveLength(3);
    expect(plan.discardedCount).toBe(0);
  });

  it("refuses a placeholder and trims narration that has no user line without a send", () => {
    expect(
      planRetryReply(
        [{ role: "assistant", content: "...", character_name: "__typing__" }],
        0,
      ).ok,
    ).toBe(false);
    const narration = planRetryReply([{ role: "assistant", content: "narration" }], 0);
    expect(narration.ok).toBe(true);
    expect(narration.userContent).toBe("");
    expect(narration.kept).toEqual([]);
  });
});

describe("planEditResend", () => {
  it("truncates from his message and returns the new wording to send once", () => {
    const plan = planEditResend(thread, 2, "  tell me a different story  ");
    expect(plan.ok).toBe(true);
    expect(plan.content).toBe("tell me a different story");
    expect(plan.kept.map((message) => message.content)).toEqual(["hello", "hi there"]);
    expect(plan.discardedCount).toBe(2);
  });

  it("blocks an empty edit so it cannot send or rewrite in place", () => {
    expect(planEditResend(thread, 2, "   ").ok).toBe(false);
    expect(planEditResend(thread, 2, "").reason).toBe("empty");
    expect(planEditResend(thread, 2, null).reason).toBe("empty");
  });

  it("does not treat an assistant bubble as an edit", () => {
    expect(planEditResend(thread, 3, "nope").reason).toBe("not_user");
  });
});

describe("lastReplyActionIndexes", () => {
  it("points at the latest real user and assistant bubbles", () => {
    const indexes = lastReplyActionIndexes([
      ...thread,
      { role: "assistant", content: "...", character_name: "__thinking__" },
    ]);
    expect(indexes).toEqual({ lastUser: 2, lastAssistant: 3 });
  });
});
