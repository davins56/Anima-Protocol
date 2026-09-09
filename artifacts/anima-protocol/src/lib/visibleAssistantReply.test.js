import { describe, expect, it } from "vitest";
import {
  createVisibleReplyFilter,
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

  it("surfaces think-only content through the stream filter on finish", () => {
    const filter = createVisibleReplyFilter();
    expect(filter.push("<think>Stay with me.</think>")).toBe("");
    expect(filter.finish()).toEqual({
      visible: "Stay with me.",
      emitted: "Stay with me.",
    });
  });
});
