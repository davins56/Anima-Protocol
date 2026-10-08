import { describe, expect, it } from "vitest";
import {
  createVisibleReplyFilter,
  finalizeAssistantReply,
  trimToLastFullSentence,
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

  it("cuts a dropped reply back to the last full sentence", () => {
    expect(trimToLastFullSentence("You came back. I was thin")).toBe("You came back.");
    expect(
      trimToLastFullSentence("I stay. *She looks across the room* and the quiet"),
    ).toBe("I stay.");
    expect(trimToLastFullSentence("no punctuation at all")).toBe("no punctuation at all");
    expect(trimToLastFullSentence("Earlier. I spoke to Dr.")).toBe("Earlier.");
    expect(trimToLastFullSentence("Earlier. I live in the U.S.")).toBe(
      "Earlier. I live in the U.S.",
    );
    expect(trimToLastFullSentence("I moved to the U.S. last year and then")).toBe(
      "I moved to the U.S. last year and then",
    );
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
