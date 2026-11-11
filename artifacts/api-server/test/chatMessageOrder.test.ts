import { describe, expect, it } from "vitest";
import {
  assistantIsAfterOwnUser,
  planTurnMessageSeqs,
  type SeqRow,
} from "../src/lib/chatMessageOrder";

const rows: SeqRow[] = [
  { id: "turn_1:user", seq: 0, at: 1_000 },
  { id: "turn_2:user", seq: 1, at: 2_000 },
  { id: "turn_2:assistant", seq: 2, at: 2_100 },
  { id: "turn_1:assistant", seq: 3, at: 3_000 },
];

describe("planTurnMessageSeqs", () => {
  it("places a missing reply immediately after its own user message", () => {
    const plan = planTurnMessageSeqs(
      rows.filter((row) => row.id !== "turn_1:assistant"),
      {
        userMessageId: "turn_1:user",
        assistantMessageId: "turn_1:assistant",
        createdAtMs: 1_000,
        includeUser: true,
      },
    );
    expect(plan.userSeq).toBeNull();
    expect(plan.reseatAssistant).toBe(false);
    expect(plan.assistantSeq).toBeGreaterThan(0);
    expect(plan.assistantSeq).toBeLessThan(1);
  });

  it("reseats a reply that was appended after a newer committed turn", () => {
    expect(assistantIsAfterOwnUser(rows, "turn_1:user", "turn_1:assistant")).toBe(false);
    const plan = planTurnMessageSeqs(rows, {
      userMessageId: "turn_1:user",
      assistantMessageId: "turn_1:assistant",
      createdAtMs: 1_000,
      includeUser: true,
    });
    expect(plan.reseatAssistant).toBe(true);
    expect(plan.assistantSeq).toBeGreaterThan(0);
    expect(plan.assistantSeq).toBeLessThan(1);
  });

  it("inserts a whole late turn by created_at, before newer messages", () => {
    const plan = planTurnMessageSeqs(
      rows.filter((row) => !row.id.startsWith("turn_1")),
      {
        userMessageId: "turn_1:user",
        assistantMessageId: "turn_1:assistant",
        createdAtMs: 500,
        includeUser: true,
      },
    );
    expect(plan.userSeq).not.toBeNull();
    expect(plan.userSeq!).toBeLessThan(1);
    expect(plan.assistantSeq).toBeGreaterThan(plan.userSeq!);
    expect(plan.assistantSeq).toBeLessThan(1);
  });

  it("appends when this turn is still the newest", () => {
    const plan = planTurnMessageSeqs(
      [
        { id: "turn_1:user", seq: 4, at: 4_000 },
      ],
      {
        userMessageId: "turn_1:user",
        assistantMessageId: "turn_1:assistant",
        createdAtMs: 4_000,
        includeUser: true,
      },
    );
    expect(plan.assistantSeq).toBe(5);
  });
});
