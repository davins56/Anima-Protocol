import { describe, expect, it } from "vitest";
import {
  COMPOSER_TERMINAL_REASONS,
  HELD_SEND_NOTE,
  combineOutgoingPayload,
  composerFullyUnlocked,
  composerTerminalReason,
  createComposerGate,
  isConversationBusyError,
  liveTurnStillBlocking,
  omitTurnMessages,
  sessionControlsLocked,
} from "./heldChatSend";

function sendThenHold(gate, sessionId, first, ...rest) {
  const started = gate.accept(sessionId, first);
  expect(started.action).toBe("send");
  for (const next of rest) {
    expect(gate.accept(sessionId, next).action).toBe("held");
  }
  return started;
}

describe("held chat send", () => {
  it("auto-sends the held message after the reply completes", () => {
    const gate = createComposerGate();
    const started = sendThenHold(gate, "sess", "hello", "you there?");
    const released = gate.release("reply_finished", started.ownerToken);
    expect(released.ignored).toBe(false);
    expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
    expect(sessionControlsLocked(gate.snapshot(), "sess")).toBe(false);
    expect(gate.takeHeld("sess")).toBe("you there?");
    expect(gate.snapshot().heldBySession.sess).toBeUndefined();
  });

  it("sends the held message after an error, the 90s timeout, and the recovery check", () => {
    for (const reason of ["error", "first_token_timeout", "recovery_check_ended"]) {
      const gate = createComposerGate();
      const started = sendThenHold(gate, "sess", "first", "still here");
      gate.release(reason, started.ownerToken);
      expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
      expect(sessionControlsLocked(gate.snapshot(), "sess")).toBe(false);
      expect(gate.takeHeld("sess")).toBe("still here");
    }
    expect(COMPOSER_TERMINAL_REASONS).toEqual([
      "reply_finished",
      "error",
      "first_token_timeout",
      "recovery_check_ended",
    ]);
  });

  it("keeps the text box usable while Continue and regenerate stay locked", () => {
    const gate = createComposerGate();
    sendThenHold(gate, "sess", "hello", "one more");
    const snap = gate.snapshot();
    expect(snap.textLocked).toBe(false);
    expect(snap.continueLocked).toBe(true);
    expect(snap.regenerateLocked).toBe(true);
    expect(sessionControlsLocked(snap, "sess")).toBe(true);
    expect(snap.heldBySession.sess.text).toBe("one more");
    expect(snap.heldBySession.sess.text).not.toMatch(/one reply ahead/i);
  });

  it("combines several follow-ups into one turn", () => {
    const gate = createComposerGate();
    sendThenHold(gate, "sess", "hello", "you there?", "I miss you");
    expect(gate.snapshot().heldBySession.sess.text).toBe("you there?\n\nI miss you");
    expect(combineOutgoingPayload("a", { text: "b", attachments: [{ type: "image" }] })).toEqual({
      text: "a\n\nb",
      attachments: [{ type: "image" }],
    });
  });

  it("cancel drops the held message so nothing sends when the reply ends", () => {
    const gate = createComposerGate();
    const started = sendThenHold(gate, "sess", "hello", "wait", "actually never mind");
    const heldId = gate.snapshot().heldBySession.sess.id;
    gate.cancel("sess", heldId);
    expect(gate.snapshot().heldBySession.sess).toBeUndefined();
    gate.release("reply_finished", started.ownerToken);
    expect(gate.takeHeld("sess")).toBeNull();
    expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
  });

  it("keeps a busy refusal held and retries only after the in-flight turn clears", () => {
    const gate = createComposerGate();
    const started = sendThenHold(gate, "sess", "hello", "also this");
    const busy = Object.assign(
      new Error("The companion is still finishing the last reply. Wait a moment, then try again."),
      { code: "conversation_busy", status: 409 },
    );
    expect(isConversationBusyError(busy)).toBe(true);
    expect(composerTerminalReason(busy)).toBe("error");
    gate.noteBusy("sess", "hello", started.ownerToken);
    const snap = gate.snapshot();
    expect(snap.textLocked).toBe(false);
    expect(snap.busyRetrySessionId).toBe("sess");
    expect(sessionControlsLocked(snap, "sess")).toBe(true);
    expect(snap.heldBySession.sess.text).toBe("hello\n\nalso this");
    expect(gate.takeHeld("sess")).toBeNull();
    expect(gate.accept("sess", "and this").action).toBe("held");
    expect(gate.snapshot().heldBySession.sess.text).toBe("hello\n\nalso this\n\nand this");

    expect(liveTurnStillBlocking({ turn_id: "t1", persistence_status: "pending" })).toBe(true);
    expect(
      liveTurnStillBlocking({
        turn_id: "t1",
        persistence_status: "pending",
        assistant_content: "I'm here.",
      }),
    ).toBe(false);
    expect(liveTurnStillBlocking({ turn_id: "t1", persistence_status: "failed" })).toBe(false);
    expect(liveTurnStillBlocking(null)).toBe(false);

    gate.clearBusyRetry("sess");
    expect(sessionControlsLocked(gate.snapshot(), "sess")).toBe(false);
    expect(gate.takeHeld("sess")).toBe("hello\n\nalso this\n\nand this");
  });

  it("does not treat a busy refusal as a hard error toast path", () => {
    expect(isConversationBusyError(new Error("No LLM provider has remaining quota."))).toBe(false);
    expect(isConversationBusyError(null)).toBe(false);
    const removed = omitTurnMessages(
      [
        { turn_id: "keep", role: "user", content: "earlier" },
        { turn_id: "turn_busy", role: "user", content: "hello" },
        { turn_id: "turn_busy", character_name: "__thinking__", content: "..." },
      ],
      "turn_busy",
    );
    expect(removed.map((message) => message.content)).toEqual(["earlier"]);
  });

  it("maps timeout and recovery onto unlock reasons", () => {
    const timeout = Object.assign(new Error("The companion took too long to reply."), {
      code: "chat_stream_timeout",
    });
    expect(composerTerminalReason(timeout)).toBe("first_token_timeout");
    expect(composerTerminalReason(timeout, { recovered: true })).toBe("recovery_check_ended");
    expect(composerTerminalReason(new Error("nope"))).toBe("error");
  });

  it("uses one waiting note", () => {
    expect(HELD_SEND_NOTE).toBe("Sends when she's done");
    expect(HELD_SEND_NOTE).not.toMatch(/one reply ahead/i);
  });

  it("does not let an older turn unlock a newer send", () => {
    const gate = createComposerGate();
    const first = gate.accept("sess-a", "hello");
    gate.detachSession("sess-a");
    const second = gate.accept("sess-b", "other chat");
    expect(gate.release("reply_finished", first.ownerToken).ignored).toBe(true);
    expect(gate.snapshot().inFlightSessionId).toBe("sess-b");
    expect(sessionControlsLocked(gate.snapshot(), "sess-b")).toBe(true);
    gate.release("reply_finished", second.ownerToken);
    expect(composerFullyUnlocked(gate.snapshot())).toBe(true);
  });
});
