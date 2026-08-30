import { describe, expect, it } from "vitest";
import {
  assessTherapySafety,
  crisisResourceForCountry,
  therapySafetyPrompt,
} from "../src/lib/therapySafety";

describe("assessTherapySafety", () => {
  it("does not escalate clearly figurative language", () => {
    expect(assessTherapySafety({ content: "I could just die 😂 that was so awkward" })).toMatchObject({
      level: "none",
      requiresDirectSafetyResponse: false,
    });
  });

  it("escalates explicit means, intent, and immediacy for a direct safety check", () => {
    const assessment = assessTherapySafety({
      content: "I have the pills next to me and I intend to take them tonight.",
    });
    expect(assessment.level).toBe("urgent");
    expect(assessment.requiresDirectSafetyResponse).toBe(true);
    expect(assessment.signals).toEqual(
      expect.arrayContaining(["means", "plan-or-intent", "immediacy"]),
    );
  });

  it("uses recent user history when the latest message is terse", () => {
    const assessment = assessTherapySafety({
      content: "I have decided to do it tonight.",
      recentMessages: [
        { role: "user", content: "I want to die and I have been saving pills." },
        { role: "assistant", content: "Are you safe right now?" },
      ],
    });
    expect(assessment.level).toBe("imminent");
    expect(assessment.signals).toContain("recent-history");
  });
});

describe("localized therapy policy", () => {
  it("uses the country's crisis resource in the authoritative policy", () => {
    const assessment = assessTherapySafety({
      content: "I want to kill myself tonight and I have pills.",
    });
    const prompt = therapySafetyPrompt(
      assessment,
      crisisResourceForCountry("GB"),
    );
    expect(prompt).toContain("Samaritans");
    expect(prompt).toContain("116 123");
    expect(prompt).toContain("999 or 112");
    expect(prompt).toMatch(/never sexualize therapy mode/i);
  });
});
