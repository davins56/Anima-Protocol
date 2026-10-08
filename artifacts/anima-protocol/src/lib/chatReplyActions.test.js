import { describe, expect, it } from "vitest";
import {
  lastReplyActionIndexes,
  messagesAfterDiscardingReply,
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

  it("drops every bubble of the same turn, including a group reply", () => {
    const grouped = planRetryReply(
      [
        { id: "t0:assistant", turn_id: "t0", role: "assistant", content: "older" },
        { id: "t1:user", turn_id: "t1", role: "user", content: "talk" },
        { id: "t1:assistant", turn_id: "t1", role: "assistant", content: "first" },
        { id: "t1:event", turn_id: "t1", role: "assistant", type: "event", content: "bell" },
        { id: "t1:assistant:1", turn_id: "t1", role: "assistant", content: "second" },
      ],
      4,
    );
    expect(grouped.ok).toBe(true);
    expect(grouped.kept.map((message) => message.content)).toEqual(["older", "talk"]);
    expect(grouped.replacedTurnId).toBe("t1");
    expect(grouped.replacedTurnIds).toEqual(["t1"]);
    expect(grouped.replacedFromMessageId).toBe("t1:assistant");
    expect(grouped.replacedMessageIds).toEqual([
      "t1:assistant",
      "t1:event",
      "t1:assistant:1",
    ]);
  });

  it("lists later user rows and does not adopt a newer turn when the reply has no turn id", () => {
    const plan = planRetryReply(
      [
        { id: "u0", turn_id: "t0", role: "user", content: "first" },
        { id: "narration", role: "assistant", content: "stage" },
        { id: "u1", turn_id: "t-new", role: "user", content: "later" },
        { id: "a1", turn_id: "t-new", role: "assistant", content: "new reply" },
      ],
      1,
    );
    expect(plan.ok).toBe(true);
    expect(plan.kept.map((message) => message.id)).toEqual(["u0"]);
    expect(plan.replacedTurnId).toBe("");
    expect(plan.replacedTurnIds).toEqual(["t-new"]);
    expect(plan.replacedFromMessageId).toBe("narration");
    expect(plan.replacedMessageIds).toEqual(["narration", "u1", "a1"]);
    expect(plan.replacedMessageIds).not.toContain("u0");
  });
});

describe("messagesAfterDiscardingReply", () => {
  it("removes her reply and a hung placeholder, and keeps his line", () => {
    const next = messagesAfterDiscardingReply(
      [
        { id: "t1:user", turn_id: "t1", role: "user", content: "hello" },
        { id: "t1:assistant", turn_id: "t1", role: "assistant", content: "old" },
        { turn_id: "t1", role: "assistant", content: "...", character_name: "__typing__" },
        { id: "t2:assistant", turn_id: "t2", role: "assistant", content: "other" },
      ],
      { turnId: "t1" },
    );
    expect(next.map((message) => message.content)).toEqual(["hello", "other"]);
  });

  it("removes his rewritten line when the edit lists that id", () => {
    const next = messagesAfterDiscardingReply(
      [
        { id: "t1:user", turn_id: "t1", role: "user", content: "old wording" },
        { id: "t1:assistant", turn_id: "t1", role: "assistant", content: "reply" },
      ],
      { turnId: "t1", messageIds: ["t1:user", "t1:assistant"] },
    );
    expect(next).toEqual([]);
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
