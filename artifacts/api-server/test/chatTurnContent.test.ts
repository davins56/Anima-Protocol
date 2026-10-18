import { describe, expect, it } from "vitest";
import { CONTINUE_USER_TURN } from "../src/lib/promptBuilder";
import {
  chatTurnContent,
  EMPTY_CHAT_CONTENT_ERROR,
} from "../src/lib/chatTurnContent";

/**
 * Bodies POST /chat/messages actually receives from animaApi.chat.sendMessage.
 * Chat.jsx passes `content` (his line, or CONTINUE_USER_TURN) and `isContinue`,
 * which the client serializes as top-level `is_continue`. Retry / edit keep
 * his line and set metadata.reply_action. They must not 400 before the model.
 */
const NATASHA_LINE =
  "We face minimal challenges actually. We're happily married and I, using my metaphysical abilities, built us a home befitting royalty";

function gate(body: { content?: unknown; is_continue?: unknown }) {
  return chatTurnContent(body);
}

describe("POST /chat/messages client request shape", () => {
  it("accepts a normal companion message with is_continue false", () => {
    const decision = gate({
      content: NATASHA_LINE,
      is_continue: false,
    });
    expect(decision.error).toBeNull();
    expect(decision.content).toBe(NATASHA_LINE);
    expect(decision.isContinue).toBe(false);
  });

  it("accepts Continue and an empty send when is_continue is true", () => {
    const continued = gate({
      content: CONTINUE_USER_TURN,
      is_continue: true,
    });
    expect(continued.error).toBeNull();
    expect(continued.isContinue).toBe(true);

    const emptyFlag = gate({ content: "", is_continue: true });
    expect(emptyFlag.error).toBeNull();
    expect(emptyFlag.isContinue).toBe(true);

    const whitespaceFlag = gate({ content: "   ", is_continue: true });
    expect(whitespaceFlag.error).toBeNull();
    expect(whitespaceFlag.content).toBe("");
  });

  it("accepts retry and edit, which resend his line and leave is_continue false", () => {
    const decision = gate({
      content: NATASHA_LINE,
      is_continue: false,
    });
    expect(decision.error).toBeNull();
    expect(decision.content).toBe(NATASHA_LINE);
    expect(decision.isContinue).toBe(false);
  });

  it("rejects an empty send that forgot is_continue before any model call", () => {
    expect(gate({ content: "" }).error).toBe(EMPTY_CHAT_CONTENT_ERROR);
    expect(gate({ content: "  ", is_continue: false }).error).toBe(
      EMPTY_CHAT_CONTENT_ERROR,
    );
    expect(gate({}).error).toBe(EMPTY_CHAT_CONTENT_ERROR);
    // The wire field is is_continue. A camelCase flag alone does not count.
    expect(gate({ content: "", isContinue: true } as { content: string }).error).toBe(
      EMPTY_CHAT_CONTENT_ERROR,
    );
  });
});
