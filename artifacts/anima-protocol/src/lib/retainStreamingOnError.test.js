import { describe, it, expect } from "vitest";
import { retainStreamingOnError } from "./retainStreamingOnError";

describe("retainStreamingOnError", () => {
  it("keeps a partial streaming reply as a final assistant message", () => {
    const { messages, retained } = retainStreamingOnError([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "Hello there",
        character_name: "Ava",
        is_streaming: true,
      },
    ]);

    expect(retained).toMatchObject({
      content: "Hello there",
      character_name: "Ava",
      is_streaming: false,
    });
    expect(messages).toHaveLength(2);
    expect(messages[1].is_streaming).toBe(false);
    expect(messages[1].content).toBe("Hello there");
  });

  it("drops empty placeholders and empty streaming bubbles", () => {
    const { messages, retained } = retainStreamingOnError([
      { role: "user", content: "hi" },
      { role: "assistant", content: "...", character_name: "__thinking__" },
      { role: "assistant", content: "...", character_name: "__typing__" },
      {
        role: "assistant",
        content: "   ",
        character_name: "Ava",
        is_streaming: true,
      },
    ]);

    expect(retained).toBeNull();
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("preserves already-finalized messages", () => {
    const input = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "prior", character_name: "Ava" },
    ];
    const { messages, retained } = retainStreamingOnError(input);
    expect(retained).toBeNull();
    expect(messages).toEqual(input);
  });
});
