import { describe, expect, it } from "vitest";
import { applyStreamingMessage } from "./useChatStreaming";

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
