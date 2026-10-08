import { describe, expect, it } from "vitest";
import {
  createVisibleReplyFilter,
  finalizeAssistantReply,
  hasThinkMarkup,
  isCutOffReply,
  settleCappedReply,
  trimToLastCompleteSentence,
  keptPartialNeedsCutOff,
  trimToLastFullSentence,
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

describe("trimToLastCompleteSentence", () => {
  it("drops the unfinished tail of a cut-off reply", () => {
    expect(trimToLastCompleteSentence("You came back. I was thinking we co")).toBe(
      "You came back.",
    );
    expect(trimToLastCompleteSentence('"Stay." She looks aw')).toBe('"Stay."');
    expect(trimToLastCompleteSentence("*nods.* Then we go tonig")).toBe("*nods.*");
  });

  it("keeps finished replies and replies with no sentence to fall back on", () => {
    expect(trimToLastCompleteSentence("All done!")).toBe("All done!");
    expect(trimToLastCompleteSentence("no punctuation at all")).toBe("no punctuation at all");
  });

  it("does not treat an honorific as a sentence end", () => {
    expect(trimToLastCompleteSentence("Ask Mr. Smith about the wa")).toBe(
      "Ask Mr. Smith about the wa",
    );
  });

  it("keeps a closed action when that keeps more than the last sentence", () => {
    expect(
      trimToLastCompleteSentence(
        "I stay. *She looks across the room* and the quiet, undist",
      ),
    ).toBe("I stay. *She looks across the room*");
  });

  it("cuts an interrupted reply back to the last full sentence", () => {
    expect(
      settleCappedReply("You came back. I was thin", {
        interrupted: true,
        timedOut: true,
      }),
    ).toBe("You came back.");
    expect(
      settleCappedReply(
        "I stay. *She looks across the room* and the quiet, undist",
        { interrupted: true, timedOut: true },
      ),
    ).toBe("I stay.");
    expect(trimToLastFullSentence("no punctuation at all")).toBe(
      "no punctuation at all",
    );
    expect(trimToLastFullSentence("Earlier. I spoke to Dr.")).toBe("Earlier.");
    expect(trimToLastFullSentence("I moved to the U.S. last year and then")).toBe(
      "I moved to the U.S. last year and then",
    );
    expect(trimToLastFullSentence("I moved to the U.S. Then I left. and")).toBe(
      "I moved to the U.S. Then I left.",
    );
    expect(keptPartialNeedsCutOff("I stay. and the", "I stay.", { timedOut: true })).toBe(
      true,
    );
    expect(
      keptPartialNeedsCutOff("I stay. and the", "I stay.", { finishReason: "length" }),
    ).toBe(true);
    expect(
      keptPartialNeedsCutOff("I stay.", "I stay.", { finishReason: "length" }),
    ).toBe(false);
    expect(
      keptPartialNeedsCutOff(
        "and the quiet undist",
        "and the quiet undist",
        { finishReason: "length" },
      ),
    ).toBe(true);
    expect(
      keptPartialNeedsCutOff("I spoke to Dr.", "I spoke to Dr.", {
        finishReason: "length",
      }),
    ).toBe(true);
    expect(keptPartialNeedsCutOff("I stay.", "", { timedOut: true })).toBe(false);
    expect(keptPartialNeedsCutOff("I stay.", "I stay.", {})).toBe(false);
    expect(isCutOffReply({ reply_interrupted: true })).toBe(true);
    expect(isCutOffReply({ cut_off: true })).toBe(true);
    expect(isCutOffReply({ interrupted: true })).toBe(false);
    expect(
      settleCappedReply("You came back. I was thin", { stoppedEarly: true }),
    ).toBe("You came back. I was thin");
  });

  it("closes an open action when there is no sentence end", () => {
    expect(trimToLastCompleteSentence("*reaches toward the quiet, undist")).toBe(
      "*reaches toward the quiet, undist*",
    );
    expect(trimToLastCompleteSentence("no punctuation at all")).toBe(
      "no punctuation at all",
    );
  });
});
