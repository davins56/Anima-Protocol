import { describe, expect, it } from "vitest";
import {
  checkExampleQuality,
  cleanExample,
  cleanExamples,
  dedupeExamples,
  hasDenylistedAssistantContent,
  normalizeTurns,
  splitExamples,
} from "../src/dataset/clean";
import type { TrainingExample } from "../src/dataset/types";

function example(over: Partial<TrainingExample> = {}): TrainingExample {
  return {
    id: over.id || "ex-1",
    source: "test",
    character: { name: "Serenity" },
    conversation: [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello there, glad you're here." },
    ],
    ...over,
  };
}

describe("normalizeTurns", () => {
  it("trims whitespace and drops empty turns", () => {
    const turns = normalizeTurns([
      { role: "user", content: "  hi  " },
      { role: "assistant", content: "   " },
      { role: "assistant", content: "hey" },
    ]);
    expect(turns).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hey" },
    ]);
  });

  it("merges consecutive same-role turns", () => {
    const turns = normalizeTurns([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
      { role: "assistant", content: "reply" },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.content).toBe("first\n\nsecond");
  });
});

describe("hasDenylistedAssistantContent", () => {
  it("flags known error/fallback text", () => {
    expect(
      hasDenylistedAssistantContent([
        { role: "assistant", content: "The companion returned an empty reply. Please try again." },
      ]),
    ).toBe(true);
  });

  it("flags generic AI refusal boilerplate", () => {
    expect(
      hasDenylistedAssistantContent([
        { role: "assistant", content: "I'm sorry, but I cannot help with that." },
      ]),
    ).toBe(true);
  });

  it("does not flag normal in-character replies", () => {
    expect(
      hasDenylistedAssistantContent([
        { role: "assistant", content: "I'm here. Tell me what happened." },
      ]),
    ).toBe(false);
  });
});

describe("checkExampleQuality", () => {
  it("passes a well-formed example", () => {
    expect(checkExampleQuality(example()).ok).toBe(true);
  });

  it("rejects an example with no assistant turn", () => {
    const ex = example({ conversation: [{ role: "user", content: "hi" }] });
    expect(checkExampleQuality(ex)).toEqual({ ok: false, reason: "no assistant turn" });
  });

  it("rejects a too-short assistant turn", () => {
    const ex = example({
      conversation: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "ok" },
      ],
    });
    expect(checkExampleQuality(ex, { minAssistantChars: 5 }).ok).toBe(false);
  });

  it("rejects denylisted assistant content", () => {
    const ex = example({
      conversation: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Error: quota exhausted, please try again later." },
      ],
    });
    expect(checkExampleQuality(ex).ok).toBe(false);
  });

  it("rejects a repeated/echoed assistant turn", () => {
    const ex = example({
      conversation: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Same reply every time." },
        { role: "user", content: "really?" },
        { role: "assistant", content: "Same reply every time." },
      ],
    });
    expect(checkExampleQuality(ex).ok).toBe(false);
  });
});

describe("cleanExample / cleanExamples", () => {
  it("returns null and reports the drop reason for bad examples", () => {
    const dropped: string[] = [];
    const ex = example({ conversation: [{ role: "user", content: "hi" }] });
    const result = cleanExample(ex, { onDrop: (_e, reason) => dropped.push(reason) });
    expect(result).toBeNull();
    expect(dropped).toEqual(["no assistant turn"]);
  });

  it("keeps good examples and filters out bad ones from a batch", () => {
    const good = example({ id: "good" });
    const bad = example({ id: "bad", conversation: [{ role: "user", content: "hi" }] });
    const result = cleanExamples([good, bad]);
    expect(result.map((e) => e.id)).toEqual(["good"]);
  });
});

describe("dedupeExamples", () => {
  it("drops exact/near-duplicate conversations, keeping the first", () => {
    const a = example({ id: "a" });
    const b = example({
      id: "b",
      conversation: [
        { role: "user", content: "  Hi  " },
        { role: "assistant", content: "Hello There, Glad You're Here." },
      ],
    });
    const c = example({ id: "c", conversation: [{ role: "user", content: "different" }, { role: "assistant", content: "totally different reply" }] });
    const result = dedupeExamples([a, b, c]);
    expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  });
});

describe("splitExamples", () => {
  it("returns everything as train when valRatio is 0", () => {
    const examples = [example({ id: "a" }), example({ id: "b" })];
    const { train, val } = splitExamples(examples, 0);
    expect(train).toHaveLength(2);
    expect(val).toHaveLength(0);
  });

  it("is deterministic across calls for the same ids", () => {
    const examples = Array.from({ length: 50 }, (_, i) => example({ id: `ex-${i}` }));
    const first = splitExamples(examples, 0.2);
    const second = splitExamples(examples, 0.2);
    expect(first.val.map((e) => e.id)).toEqual(second.val.map((e) => e.id));
    expect(first.train.length + first.val.length).toBe(examples.length);
  });
});
