import { describe, expect, it } from "vitest";
import { isTransientMessage, settleMessages } from "./settledMessages";

describe("settleMessages", () => {
  const a = { role: "user", content: "hi" };
  const b = { role: "assistant", content: "hello", character_name: "Serenity" };

  it("drops typing, thinking and streaming rows", () => {
    const rows = [
      a,
      { role: "assistant", character_name: "__typing__", content: "..." },
      { role: "assistant", character_name: "__thinking__", content: "..." },
      { role: "assistant", character_name: "Serenity", content: "hel", is_streaming: true },
    ];
    expect(settleMessages(rows, null)).toEqual([a]);
    expect(isTransientMessage(b)).toBe(false);
  });

  it("keeps the previous array while only the streaming bubble changes", () => {
    const first = settleMessages([a, b, { role: "assistant", content: "x", is_streaming: true }], null);
    const second = settleMessages([a, b, { role: "assistant", content: "xy", is_streaming: true }], first);
    expect(second).toBe(first);
  });

  it("returns a new array once the reply lands", () => {
    const first = settleMessages([a, { role: "assistant", content: "x", is_streaming: true }], null);
    const landed = { role: "assistant", content: "xyz", character_name: "Serenity" };
    const second = settleMessages([a, landed], first);
    expect(second).not.toBe(first);
    expect(second).toEqual([a, landed]);
  });
});
