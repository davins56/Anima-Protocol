import { describe, expect, it } from "vitest";
import {
  createVisibleReplyFilter,
  finalizeAssistantReply,
  hasThinkMarkup,
  visibleAssistantReply,
} from "../src/lib/visibleAssistantReply";

describe("visibleAssistantReply", () => {
  it("leaves ordinary replies untouched", () => {
    expect(visibleAssistantReply("Hello there.")).toBe("Hello there.");
    expect(visibleAssistantReply("")).toBe("");
    expect(hasThinkMarkup("Hello there.")).toBe(false);
    expect(hasThinkMarkup("<think>plan")).toBe(true);
  });

  it("keeps the answer after DeepSeek R1 think tags", () => {
    expect(
      visibleAssistantReply("<think>plan the scene</think>\n\nI hear you."),
    ).toBe("I hear you.");
  });

  it("does not drop a think-only reply to empty", () => {
    expect(visibleAssistantReply("<think>I hear you. Stay close.</think>")).toBe(
      "I hear you. Stay close.",
    );
    expect(
      visibleAssistantReply("<think>still forming the line", {
        allowThinkFallback: true,
      }),
    ).toBe("still forming the line");
  });

  it("can still hide unclosed think when fallback is explicitly denied", () => {
    expect(
      visibleAssistantReply("<think>hidden so far", { allowThinkFallback: false }),
    ).toBe("");
  });

  it("treats a long unclosed think-only completion as visible inner text", () => {
    const inner = `${"I hear you. ".repeat(80)}Stay close.`;
    const raw = `<think>${inner}`;
    expect(raw.includes("</think>")).toBe(false);
    expect(visibleAssistantReply(raw).trim()).toBe(inner.trim());
    expect(finalizeAssistantReply(raw)).toBe(inner.trim());
  });
});

describe("createVisibleReplyFilter", () => {
  it("emits unclosed think inner text instead of waiting for </think>", () => {
    const filter = createVisibleReplyFilter();
    expect(filter.push("<think>Stay with me.")).toBe("Stay with me.");
    expect(filter.peek()).toBe("Stay with me.");
    expect(filter.finish()).toEqual({
      visible: "Stay with me.",
      emitted: "",
    });
  });

  it("switches to the post-think answer when the tag later closes", () => {
    const filter = createVisibleReplyFilter();
    expect(filter.push("<think>reasoning")).toBe("reasoning");
    expect(filter.push(" tokens</think>\n\n")).toBe(" tokens");
    expect(filter.push("Visible line.")).toBe("");
    expect(filter.finish()).toEqual({
      visible: "Visible line.",
      emitted: "Visible line.",
    });
  });

  it("surfaces think-only content so the bubble is not empty", () => {
    const filter = createVisibleReplyFilter();
    expect(filter.push("<think>Stay with me.</think>")).toBe("Stay with me.");
    const finished = filter.finish();
    expect(finished.visible).toBe("Stay with me.");
    expect(finished.emitted).toBe("");
  });
});

describe("finalizeAssistantReply", () => {
  it("prefers the first usable part and never waits for a closing tag", () => {
    expect(finalizeAssistantReply("", "<think>I hear you.")).toBe("I hear you.");
    expect(finalizeAssistantReply("<think>plan</think>\n\nAnswer", "ignored")).toBe(
      "Answer",
    );
    expect(finalizeAssistantReply("", "", null)).toBe("");
  });
});
