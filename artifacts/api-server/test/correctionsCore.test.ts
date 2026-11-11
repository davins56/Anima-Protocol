import { describe, expect, it } from "vitest";
import {
  currentCorrectionBlock,
  formatCorrectionsBlock,
  parseCurrentCorrection,
  selectCorrections,
  toCorrection,
  type Correction,
} from "../src/lib/corrections/correctionsCore";

function c(lastUser: string, over: Partial<Correction> = {}): Correction {
  return { lastUser, reply: `reply to ${lastUser}`, better: "a better reply", note: null, createdAt: "2026-11-05T00:00:00Z", ...over };
}

describe("corrections: rows", () => {
  it("keeps thumbs-downs with a better version or a note, using the last user turn", () => {
    const row = {
      reply: "Hmm.",
      better_reply: "Yes — the launch is Friday.",
      note: null,
      context: [
        { role: "user", content: "first" },
        { role: "assistant", content: "x" },
        { role: "user", content: "When is the launch?" },
      ],
      created_at: new Date("2026-11-05T00:00:00Z"),
    };
    expect(toCorrection(row)).toEqual({
      lastUser: "When is the launch?",
      reply: "Hmm.",
      better: "Yes — the launch is Friday.",
      note: null,
      createdAt: "2026-11-05T00:00:00.000Z",
    });
    expect(toCorrection({ reply: "Hmm.", better_reply: null, note: "  " })).toBeNull();
    expect(toCorrection({ reply: "", note: "answer me" })).toBeNull();
  });
});

describe("corrections: selection", () => {
  const list = [
    c("what time is the book launch", { note: "Answer the question first." }),
    c("tell me about your day"),
    c("how is the slipthk cover coming", { better: "It's nearly done." }),
    c("random", { note: "Less flowery." }),
  ];

  it("puts the most relevant correction first", () => {
    const picked = selectCorrections(list, "When is the book launch again?");
    expect(picked[0].lastUser).toBe("what time is the book launch");
  });

  it("fills with recent general notes, capped", () => {
    const picked = selectCorrections(list, "completely unrelated words here", { max: 3 });
    expect(picked.map((p) => p.note)).toEqual(["Answer the question first.", "Less flowery."]);
  });

  it("never returns more than max, or duplicates", () => {
    const picked = selectCorrections(list, "book launch slipthk cover", { max: 2 });
    expect(picked).toHaveLength(2);
    expect(new Set(picked).size).toBe(2);
  });

  it("returns nothing when there is nothing", () => {
    expect(selectCorrections([], "anything")).toEqual([]);
  });
});

describe("corrections: prompt text", () => {
  it("formats lessons within budget and without double quotes leaking", () => {
    const block = formatCorrectionsBlock([c('she said "hi"', { note: "Be direct." })]);
    expect(block).toContain("STEWARD CORRECTIONS");
    expect(block).toContain("When they said \"she said 'hi'\"");
    expect(block).toContain("What was wrong: Be direct.");
    expect(formatCorrectionsBlock([])).toBe("");
    const many = Array.from({ length: 20 }, (_, i) => c(`question number ${i} ${"x".repeat(100)}`, { note: "n".repeat(200) }));
    expect(formatCorrectionsBlock(many).length).toBeLessThanOrEqual(1200);
  });

  it("tells the re-render exactly what to fix, in her voice", () => {
    const block = currentCorrectionBlock({ original: "Hmm, maybe.", better: "Friday at 7.", note: "You dodged the question." });
    expect(block).toContain("JUST CORRECTED YOUR LAST REPLY");
    expect(block).toContain('Your reply was: "Hmm, maybe."');
    expect(block).toContain("What was wrong: You dodged the question.");
    expect(block).toContain("keep your own words");
    expect(currentCorrectionBlock({ original: "x", better: null, note: null })).toBe("");
  });

  it("sanitizes a client-sent correction", () => {
    expect(parseCurrentCorrection({ original: "a", better: "b" })).toEqual({ original: "a", better: "b", note: null });
    expect(parseCurrentCorrection({ original: "a" })).toBeNull();
    expect(parseCurrentCorrection("nope")).toBeNull();
    expect(parseCurrentCorrection({ original: "a", note: "n".repeat(900) })?.note).toHaveLength(600);
  });
});
