import { describe, expect, it } from "vitest";
import {
  cleanExamples,
  cleanTurns,
  conversationFingerprint,
  isLowQuality,
  type TrainingExample,
} from "../src/dataset";

function example(overrides: Partial<TrainingExample> = {}): TrainingExample {
  return {
    id: "ex-1",
    source: "test",
    character: { name: "Serenity" },
    conversation: [
      { role: "user", content: "I feel overwhelmed tonight." },
      {
        role: "assistant",
        content: "Then let the world go quiet between us for a moment. I am here.",
      },
      { role: "user", content: "Do you remember what I told you?" },
      {
        role: "assistant",
        content: "Yes. I remember, and I am not tidying it away from you.",
      },
    ],
    ...overrides,
  };
}

describe("cleanTurns", () => {
  it("drops empty and error-artifact turns", () => {
    const cleaned = cleanTurns([
      { role: "user", content: "hello" },
      { role: "assistant", content: "The companion returned an empty reply. Please try again." },
      { role: "user", content: "   " },
      { role: "assistant", content: "real reply here" },
    ]);
    expect(cleaned).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "real reply here" },
    ]);
  });

  it("collapses accidental consecutive duplicate turns", () => {
    const cleaned = cleanTurns([
      { role: "user", content: "hi there" },
      { role: "user", content: "hi there" },
      { role: "assistant", content: "hello!" },
    ]);
    expect(cleaned).toHaveLength(2);
  });

  it("redacts emails and phone numbers by default", () => {
    const cleaned = cleanTurns([
      { role: "user", content: "reach me at jane@example.com or 555-123-4567" },
    ]);
    expect(cleaned[0]?.content).toBe("reach me at [email] or [phone]");
  });

  it("skips redaction when redactPii is false", () => {
    const cleaned = cleanTurns(
      [{ role: "user", content: "email me at jane@example.com" }],
      { redactPii: false },
    );
    expect(cleaned[0]?.content).toContain("jane@example.com");
  });
});

describe("isLowQuality", () => {
  it("keeps a substantive multi-turn example", () => {
    expect(isLowQuality(example())).toBe(false);
  });

  it("drops examples below the minimum turn count", () => {
    expect(
      isLowQuality(
        example({
          conversation: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello there, how are you today?" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("drops examples whose assistant replies are too short on average", () => {
    expect(
      isLowQuality(
        example({
          conversation: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "ok" },
            { role: "user", content: "really?" },
            { role: "assistant", content: "yep" },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("conversationFingerprint", () => {
  it("is stable for the same conversation regardless of whitespace/case", () => {
    const a = conversationFingerprint(example());
    const b = conversationFingerprint(
      example({
        conversation: example().conversation.map((t) => ({
          ...t,
          content: t.content.toUpperCase(),
        })),
      }),
    );
    expect(a).toBe(b);
  });

  it("differs for different conversations", () => {
    const a = conversationFingerprint(example());
    const b = conversationFingerprint(example({ id: "ex-2", conversation: [
      { role: "user", content: "totally different opener" },
      { role: "assistant", content: "totally different, substantive reply back to you" },
      { role: "user", content: "another distinct line" },
      { role: "assistant", content: "and another distinct, substantive reply" },
    ] }));
    expect(a).not.toBe(b);
  });
});

describe("cleanExamples", () => {
  it("keeps good examples, drops low-quality ones, and de-dupes near-identical ones", () => {
    const good = example();
    const duplicate = example({ id: "ex-1-dup" });
    const thin = example({
      id: "ex-thin",
      conversation: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "ok" },
      ],
    });

    const { kept, dropped, deduped } = cleanExamples([good, duplicate, thin]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.id).toBe("ex-1");
    expect(dropped).toBe(1);
    expect(deduped).toBe(1);
  });
});
