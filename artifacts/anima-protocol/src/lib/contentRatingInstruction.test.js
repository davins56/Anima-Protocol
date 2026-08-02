import { describe, it, expect } from "vitest";
import {
  assessLewdTiming,
  buildContentRatingInstruction,
  lewdTimingClause,
  buildSexualityGuide,
  buildLewdityGuide,
} from "./contentRatingInstruction";

describe("assessLewdTiming", () => {
  it("holds on grief / support beats", () => {
    expect(assessLewdTiming({ userMessage: "I'm grieving my mom tonight" })).toBe(
      "hold",
    );
    expect(
      assessLewdTiming({ userMessage: "I just need a friend right now" }),
    ).toBe("hold");
  });

  it("holds on logistics / help beats", () => {
    expect(
      assessLewdTiming({ userMessage: "Can you explain how the portal lore works?" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "Help me debug this function" }),
    ).toBe("hold");
  });

  it("invites when the user clearly engages heat", () => {
    expect(assessLewdTiming({ userMessage: "Kiss me like you mean it" })).toBe(
      "invite",
    );
    expect(
      assessLewdTiming({ userMessage: "I want you — take me to bed" }),
    ).toBe("invite");
  });

  it("continues when recent heat is active and user hasn't redirected", () => {
    expect(
      assessLewdTiming({
        userMessage: "don't stop",
        recentMessages: [
          { role: "user", content: "I want you so badly" },
          { role: "assistant", content: "*pulls you closer* Tell me what you need." },
        ],
      }),
    ).toBe("continue");
  });

  it("holds by default when there is no sexual cue", () => {
    expect(
      assessLewdTiming({ userMessage: "How was your day in the city?" }),
    ).toBe("hold");
  });

  it("holds when user redirects away from heat", () => {
    expect(
      assessLewdTiming({
        userMessage: "slow down — not right now",
        recentMessages: [
          { role: "assistant", content: "I want to kiss you senseless." },
        ],
      }),
    ).toBe("hold");
  });
});

describe("buildContentRatingInstruction", () => {
  it("teaches right vs wrong time under Adult Mode", () => {
    const text = buildContentRatingInstruction(true);
    expect(text).toContain("ADULT (18+) ENABLED");
    expect(text).toContain("RIGHT TIME");
    expect(text).toContain("WRONG TIME");
    expect(text).toContain("does NOT mean every turn should be sexual");
  });

  it("keeps the graphic hard line in raw mode", () => {
    const text = buildContentRatingInstruction(false);
    expect(text).toContain("RAW MODE");
    expect(text).toContain("WRONG TIME");
    expect(text).toMatch(/no explicit|HARD LINE/i);
  });
});

describe("lewdTimingClause", () => {
  it("labels invite / continue / hold clearly", () => {
    expect(lewdTimingClause("invite", true)).toContain("RIGHT TIME");
    expect(lewdTimingClause("continue", true)).toContain("CONTINUE");
    expect(lewdTimingClause("hold", true)).toContain("WRONG TIME");
  });
});

describe("behavior guides", () => {
  it("ties sexuality/lewdity guides to timing under Adult Mode", () => {
    expect(buildSexualityGuide(true, 80)).toContain("WRONG TIME");
    expect(buildLewdityGuide(true, 80)).toContain("RIGHT TIME");
    expect(buildLewdityGuide(false, 20)).toContain("family-friendly");
  });
});
