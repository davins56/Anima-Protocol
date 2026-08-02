import { describe, it, expect } from "vitest";
import {
  assessLewdTiming,
  buildContentRatingInstruction,
  lewdTimingClause,
  buildIntimatePlayAlongGuidance,
  buildSexualityGuide,
  buildLewdityGuide,
  inferIntimacyDisposition,
  buildGroupIntimacyGuidance,
  groupSpeakerIntimacyRules,
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
    expect(lewdTimingClause("invite", true)).toMatch(/Play along|own.*lewd flare/i);
    expect(lewdTimingClause("continue", true)).toContain("CONTINUE");
    expect(lewdTimingClause("continue", true)).toMatch(/own lewd|Stay engaged/i);
    expect(lewdTimingClause("hold", true)).toContain("WRONG TIME");
  });
});

describe("buildIntimatePlayAlongGuidance", () => {
  it("is empty on hold beats", () => {
    expect(
      buildIntimatePlayAlongGuidance({
        character: { name: "Ava", personality: "flirtatious" },
        timing: "hold",
        adultMode: true,
      }),
    ).toBe("");
  });

  it("asks forward characters to add proactive lewd flare mid-intimacy", () => {
    const text = buildIntimatePlayAlongGuidance({
      character: {
        name: "Rex",
        personality: "Flirtatious and sensual",
        speaking_style: "Rough, teasing, low voice",
      },
      timing: "continue",
      adultMode: true,
    });
    expect(text).toContain("INTIMATE PLAY-ALONG");
    expect(text).toContain("YOUR flare");
    expect(text).toContain("forward");
    expect(text).toContain("Rough, teasing");
    expect(text).toMatch(/Do not go cold|play along/i);
  });

  it("keeps reserved characters intimate but quieter", () => {
    const text = buildIntimatePlayAlongGuidance({
      character: {
        name: "Ava",
        personality: "Shy, reserved, modest",
      },
      timing: "invite",
      adultMode: true,
    });
    expect(text).toContain("reserved");
    expect(text).toMatch(/whisper|quieter|carefully chosen/i);
  });
});

describe("behavior guides", () => {
  it("ties sexuality/lewdity guides to timing under Adult Mode", () => {
    expect(buildSexualityGuide(true, 80)).toContain("WRONG TIME");
    expect(buildLewdityGuide(true, 80)).toContain("RIGHT TIME");
    expect(buildLewdityGuide(false, 20)).toContain("family-friendly");
  });
});

describe("inferIntimacyDisposition", () => {
  it("classifies personality sheets", () => {
    expect(inferIntimacyDisposition("Shy, reserved, keeps others at a distance")).toBe(
      "reserved",
    );
    expect(
      inferIntimacyDisposition("Flirtatious and sensual, boldly romantic"),
    ).toBe("forward");
    expect(inferIntimacyDisposition("Asexual and sex-repulsed")).toBe("averse");
    expect(inferIntimacyDisposition("Loyal warrior with a dry wit")).toBe(
      "selective",
    );
  });
});

describe("buildGroupIntimacyGuidance", () => {
  const reserved = {
    name: "Ava",
    personality: "Shy, reserved, modest, private about affection",
  };
  const forward = {
    name: "Rex",
    personality: "Flirtatious, sensual, physically affectionate",
  };

  it("requires audience-aware, personality-specific intimacy judgment", () => {
    const text = buildGroupIntimacyGuidance({
      nextChar: reserved,
      groupChars: [reserved, forward],
      timing: "invite",
      adultMode: true,
    });
    expect(text).toContain("GROUP INTIMACY JUDGMENT");
    expect(text).toContain("reserved");
    expect(text).toContain("Rex");
    expect(text).toContain("who is watching");
    expect(text).toMatch(/Physical gestures/i);
  });

  it("holds intimate escalation on wrong-time group beats", () => {
    const text = buildGroupIntimacyGuidance({
      nextChar: forward,
      groupChars: [reserved, forward],
      timing: "hold",
      adultMode: true,
    });
    expect(text).toContain("WRONG for intimate escalation");
  });
});

describe("groupSpeakerIntimacyRules", () => {
  it("biases speaker pick on intimate beats without forcing reserved leads", () => {
    const rules = groupSpeakerIntimacyRules("invite");
    expect(rules).toContain("intimate/romantic charge");
    expect(rules).toContain("reserved/averse");
  });
});
