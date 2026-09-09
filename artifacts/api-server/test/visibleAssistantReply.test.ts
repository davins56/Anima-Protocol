import { describe, expect, it } from "vitest";
import {
  createVisibleReplyFilter,
  visibleAssistantReply,
} from "../src/lib/visibleAssistantReply";

describe("visibleAssistantReply", () => {
  it("leaves ordinary replies untouched", () => {
    expect(visibleAssistantReply("Hello there.")).toBe("Hello there.");
    expect(visibleAssistantReply("")).toBe("");
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

  it("hides unclosed think during streaming until fallback is allowed", () => {
    expect(
      visibleAssistantReply("<think>hidden so far", { allowThinkFallback: false }),
    ).toBe("");
  });
});

describe("createVisibleReplyFilter", () => {
  it("emits only the post-think answer, then falls back to think-only text", () => {
    const filter = createVisibleReplyFilter();
    expect(filter.push("<think>reasoning")).toBe("");
    expect(filter.push(" tokens</think>\n\n")).toBe("");
    expect(filter.push("Visible line.")).toBe("Visible line.");
    expect(filter.finish()).toEqual({
      visible: "Visible line.",
      emitted: "",
    });
  });

  it("surfaces think-only content on finish so the bubble is not empty", () => {
    const filter = createVisibleReplyFilter();
    expect(filter.push("<think>Stay with me.</think>")).toBe("");
    const finished = filter.finish();
    expect(finished.visible).toBe("Stay with me.");
    expect(finished.emitted).toBe("Stay with me.");
  });
});
