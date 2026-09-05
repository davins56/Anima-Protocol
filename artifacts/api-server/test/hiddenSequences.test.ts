import { describe, expect, it } from "vitest";
import {
  hiddenSequencePromptBlock,
  readConversationalWeather,
  shouldTriggerExperienceMilestone,
  significantExperienceCount,
} from "../src/lib/hiddenSequences";

describe("api hidden sequences", () => {
  it("reads storm vs lull vs stir from the live thread", () => {
    expect(
      readConversationalWeather([
        { content: "Halo.Vrs is here — fallen light." },
      ]),
    ).toBe("storm");
    expect(
      readConversationalWeather([{ content: "I am a fallen angel who stayed." }]),
    ).toBe("lull");
    expect(
      readConversationalWeather([{ content: "Nova Pulse tastes like metal light." }]),
    ).toBe("stir");
    expect(
      readConversationalWeather([{ content: "Halo.Vrs" }], { therapy_mode: true }),
    ).toBe("lull");
  });

  it("builds a prompt layer without a tutorial card", () => {
    const block = hiddenSequencePromptBlock({
      weather: "stir",
      hidden: {
        sequences: {
          "star-triad": {
            fired_at: "2026-01-01T00:00:00.000Z",
            integrated_at: "2026-01-02T00:00:00.000Z",
          },
        },
      },
    });
    expect(block).toContain("CONVERSATIONAL WEATHER: stir");
    expect(block).toContain("Star Triad");
    expect(block).toMatch(/naming/);
    expect(block).not.toMatch(/tutorial card that explains/i);
  });

  it("counts significant experiences toward milestones", () => {
    expect(
      significantExperienceCount({
        learned_life: [
          { kind: "scar", title: "a", significant: true },
          { kind: "trust", title: "b", significant: true },
        ],
      }),
    ).toBe(2);
    expect(
      shouldTriggerExperienceMilestone({
        conversationCount: 12,
        significantExperienceCount: 50,
        alreadyMilestone: 0,
      }),
    ).toBe(50);
  });
});
