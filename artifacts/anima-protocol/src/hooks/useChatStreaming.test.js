import { describe, expect, it } from "vitest";
import { applyStreamingMessage, stitchLiveMessages } from "./useChatStreaming";

const prefix = [
  { id: "m1", role: "user", content: "hello from A" },
];
const streamBubble = {
  role: "assistant",
  content: "Hel",
  character_name: "Aria",
  is_streaming: true,
};

describe("applyStreamingMessage", () => {
  it("paints the streaming bubble onto the session that started the send", () => {
    const session = { id: "sess-a", messages: prefix };
    const next = applyStreamingMessage(session, {
      sessionId: "sess-a",
      prefixMessages: prefix,
      message: streamBubble,
    });
    expect(next.messages).toEqual([...prefix, streamBubble]);
  });

  it("does not replace another thread after /chat/:id navigation", () => {
    const sessionB = {
      id: "sess-b",
      messages: [{ id: "b1", role: "user", content: "other thread" }],
    };
    const next = applyStreamingMessage(sessionB, {
      sessionId: "sess-a",
      prefixMessages: prefix,
      message: streamBubble,
    });
    expect(next).toBe(sessionB);
    expect(next.messages.map((m) => m.content)).toEqual(["other thread"]);
  });

  it("keeps an earlier turn's late reply while this turn streams", () => {
    const user1 = { id: "t1:user", turn_id: "t1", role: "user", content: "Hello" };
    const late = {
      id: "t1:assistant",
      turn_id: "t1",
      role: "assistant",
      content: "I stayed.",
    };
    const user2 = { id: "t2:user", turn_id: "t2", role: "user", content: "Also this" };
    const typing = {
      turn_id: "t2",
      role: "assistant",
      content: "...",
      character_name: "__typing__",
    };
    const partial = {
      turn_id: "t2",
      role: "assistant",
      content: "Hel",
      character_name: "Aria",
      is_streaming: true,
    };
    const session = { id: "sess-a", messages: [user1, late, user2, typing] };
    const next = applyStreamingMessage(session, {
      sessionId: "sess-a",
      prefixMessages: [user1, user2],
      message: partial,
    });
    expect(next.messages.map((message) => message.id || message.content)).toEqual([
      "t1:user",
      "t1:assistant",
      "t2:user",
      "Hel",
    ]);
  });

  it("drops a stale typing bubble from an earlier id of this send", () => {
    const user = { id: "t2:user", turn_id: "t2", role: "user", content: "Hello" };
    const stale = {
      turn_id: "t2-old",
      role: "assistant",
      content: "...",
      character_name: "__typing__",
    };
    const partial = { turn_id: "t2", role: "assistant", content: "Hel", is_streaming: true };
    expect(
      stitchLiveMessages([user, stale], [user, partial], "t2").map((message) => message.content),
    ).toEqual(["Hello", "Hel"]);
  });

  it("does not duplicate a late reply that is already in the snapshot", () => {
    const user1 = { id: "t1:user", turn_id: "t1", role: "user", content: "Hello" };
    const late = { id: "t1:assistant", turn_id: "t1", role: "assistant", content: "I stayed." };
    const reply = { id: "t2:assistant", turn_id: "t2", role: "assistant", content: "Next." };
    expect(
      stitchLiveMessages([user1, late, reply], [user1, late, reply], "t2").map((message) => message.id),
    ).toEqual(["t1:user", "t1:assistant", "t2:assistant"]);
  });

  it("leaves a missing session untouched", () => {
    expect(
      applyStreamingMessage(null, {
        sessionId: "sess-a",
        prefixMessages: prefix,
        message: streamBubble,
      }),
    ).toBeNull();
  });
});
