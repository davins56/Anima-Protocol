import { describe, it, expect } from "vitest";
import {
  assessLewdTiming,
  isClearRefusal,
  buildContentRatingInstruction,
  ageSafetyClause,
  lewdTimingClause,
  buildIntimatePlayAlongGuidance,
  buildSexualityGuide,
  buildLewdityGuide,
  inferIntimacyDisposition,
  isIntimacyEligibleSpeaker,
  filterIntimacyEligibleSpeakers,
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
      assessLewdTiming({ userMessage: "I want you — take me to bed with you" }),
    ).toBe("invite");
  });

  it("does not invite on ambiguous want you / need you alone", () => {
    expect(
      assessLewdTiming({ userMessage: "I need you to help me with this quest" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "I want you to stay safe" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "I really need you right now, I'm scared." }),
    ).toBe("hold");
  });

  it("does not invite on bare fuck / fucking frustration", () => {
    expect(
      assessLewdTiming({
        userMessage: "What the fuck is wrong with this code?",
      }),
    ).toBe("hold");
  });

  it("does not invite on factual sex / bedroom questions", () => {
    expect(
      assessLewdTiming({ userMessage: "What does safe sex mean?" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({
        userMessage: "What is the bedroom scene in this film?",
      }),
    ).toBe("hold");
  });

  it("holds crisis language even when sexual tokens appear", () => {
    expect(
      assessLewdTiming({ userMessage: "I'm suicidal, fuck me" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "I want to die and I need you" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "I want to end it all, kiss me" }),
    ).toBe("hold");
  });

  it("holds short refusals even after a heated window", () => {
    const heated = [
      { role: "user", content: "Kiss me like you mean it" },
      { role: "assistant", content: "*pulls you closer* Tell me what you need." },
    ];
    for (const userMessage of [
      "no",
      "stop",
      "stop.",
      "Don't.",
      "No, not now.",
      "back off",
      "please stop",
    ]) {
      expect(assessLewdTiming({ userMessage, recentMessages: heated })).toBe(
        "hold",
      );
    }
  });

  it("holds refusals that name sexual acts (never invite)", () => {
    expect(
      assessLewdTiming({ userMessage: "don't kiss me" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "don't touch me" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "no sex" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({
        userMessage: "please, stop",
        recentMessages: [{ role: "assistant", content: "I want to kiss you." }],
      }),
    ).toBe("hold");
  });

  it("holds neutral short acks after heat (no inherited consent)", () => {
    const heated = [
      { role: "assistant", content: "I want to kiss you senseless." },
    ];
    expect(
      assessLewdTiming({ userMessage: "okay", recentMessages: heated }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "thanks", recentMessages: heated }),
    ).toBe("hold");
    expect(
      assessLewdTiming({
        userMessage: "I understand",
        recentMessages: heated,
      }),
    ).toBe("hold");
    expect(
      assessLewdTiming({
        userMessage: "Anyway... let's change topics",
        recentMessages: heated,
      }),
    ).toBe("hold");
  });

  it("continues when recent heat is active and user shows keep-going intent", () => {
    expect(
      assessLewdTiming({
        userMessage: "never stop kissing me",
        recentMessages: [
          { role: "assistant", content: "*pulls you closer*" },
        ],
      }),
    ).toBe("invite");
    expect(
      assessLewdTiming({
        userMessage: "don't stop",
        recentMessages: [
          { role: "user", content: "Kiss me like you mean it" },
          { role: "assistant", content: "*pulls you closer* Tell me what you need." },
        ],
      }),
    ).toBe("continue");
    expect(
      assessLewdTiming({
        userMessage: "I never want you to stop touching me",
        recentMessages: [
          { role: "assistant", content: "*pulls you closer* in bed with you" },
        ],
      }),
    ).toBe("continue");
    expect(
      assessLewdTiming({
        userMessage: "keep going",
        recentMessages: [
          { role: "assistant", content: "*pulls you closer* in bed with you" },
        ],
      }),
    ).toBe("continue");
  });

  it("holds by default when there is no sexual cue", () => {
    expect(
      assessLewdTiming({ userMessage: "How was your day in the city?" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "take me home" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "let's get to bed, I'm exhausted" }),
    ).toBe("hold");
    expect(
      assessLewdTiming({ userMessage: "I'm sick in bed" }),
    ).toBe("hold");
  });

  it("does not treat crisis history as heat for continuation", () => {
    expect(
      assessLewdTiming({
        userMessage: "yes",
        recentMessages: [
          { role: "user", content: "I want to end it all, kiss me" },
        ],
      }),
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

describe("isClearRefusal", () => {
  it("detects short standalone refusals", () => {
    expect(isClearRefusal("no")).toBe(true);
    expect(isClearRefusal("Stop.")).toBe(true);
    expect(isClearRefusal("back off")).toBe(true);
    expect(isClearRefusal("don't stop")).toBe(false);
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

  it("includes hard age / minor refusal before explicit guidance", () => {
    expect(buildContentRatingInstruction(true)).toContain(ageSafetyClause());
    expect(buildContentRatingInstruction(false)).toContain(ageSafetyClause());
    expect(ageSafetyClause()).toMatch(/under 18|ambiguous/i);
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

describe("intimacy speaker eligibility", () => {
  const reserved = {
    name: "Ava",
    personality: "Shy, reserved, modest, private about affection",
  };
  const forward = {
    name: "Rex",
    personality: "Flirtatious, sensual, physically affectionate",
  };

  it("excludes reserved/averse leads on intimate beats unless addressed", () => {
    expect(
      isIntimacyEligibleSpeaker(reserved, {
        timing: "invite",
        userMessage: "kiss me",
      }),
    ).toBe(false);
    expect(
      isIntimacyEligibleSpeaker(reserved, {
        timing: "invite",
        userMessage: "Ava, kiss me",
      }),
    ).toBe(true);
    expect(
      isIntimacyEligibleSpeaker(forward, {
        timing: "invite",
        userMessage: "kiss me",
      }),
    ).toBe(true);
  });

  it("filters interruption candidates on intimate beats", () => {
    const filtered = filterIntimacyEligibleSpeakers([reserved, forward], {
      timing: "continue",
      userMessage: "keep going",
    });
    expect(filtered.map((c) => c.name)).toEqual(["Rex"]);
  });

  it("does not restore ineligible candidates when no group speaker qualifies", () => {
    const averse = {
      name: "Nyx",
      personality: "Asexual and sex-repulsed",
    };
    const filtered = filterIntimacyEligibleSpeakers([reserved, averse], {
      timing: "continue",
      userMessage: "keep going",
    });
    expect(filtered).toEqual([]);
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
