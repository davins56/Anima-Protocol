import { describe, expect, it } from "vitest";
import {
  assignTurnMessageIds,
  createChatTurnId,
} from "./useChatPersistence";

describe("chat persistence identifiers", () => {
  it("creates server-accepted idempotency keys", () => {
    expect(createChatTurnId()).toMatch(/^turn_[A-Za-z0-9_-]{8,}/);
  });

  it("assigns stable ids to a complete visible turn", () => {
    const messages = assignTurnMessageIds(
      [
        { role: "user", content: "hello" },
        { role: "assistant", type: "event", content: "calm" },
        { role: "assistant", content: "first" },
        { role: "assistant", content: "second" },
      ],
      "turn_example123",
    );

    expect(messages.map((message) => message.id)).toEqual([
      "turn_example123:user",
      "turn_example123:event",
      "turn_example123:assistant",
      "turn_example123:assistant:1",
    ]);
    expect(messages.every((message) => message.turn_id === "turn_example123")).toBe(
      true,
    );
  });
});
