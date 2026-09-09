import { describe, expect, it } from "vitest";
import {
  createVisibleReplyFilter,
  finalizeAssistantReply,
  visibleAssistantReply,
} from "./visibleAssistantReply";

describe("visibleAssistantReply", () => {
  it("keeps the answer after DeepSeek R1 think tags", () => {
    expect(
      visibleAssistantReply("<think>plan the scene</think>\n\nI hear you."),
    ).toBe("I hear you.");
  });

  it("does not drop a think-only reply to empty", () => {
    expect(visibleAssistantReply("<think>I hear you. Stay close.</think>")).toBe(
      "I hear you. Stay close.",
    );
  });

  it("treats unclosed think-only text as visible inner content", () => {
    const inner = `${"I hear you. ".repeat(80)}Stay close.`;
    expect(finalizeAssistantReply(`<think>${inner}`)).toBe(inner.trim());
  });

  it("surfaces unclosed think through the stream filter without waiting for </think>", () => {
    const filter = createVisibleReplyFilter();
    expect(filter.push("<think>Stay with me.")).toBe("Stay with me.");
    expect(filter.finish()).toEqual({
      visible: "Stay with me.",
      emitted: "",
    });
  });
});
