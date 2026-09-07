import { describe, expect, it } from "vitest";
import { FEATURE_MESSAGING, getFeatureMessage } from "./featureMessaging";

describe("FEATURE_MESSAGING public language", () => {
  it("positions Anima as the home screen for AI relationships", () => {
    expect(FEATURE_MESSAGING.APP_NAME).toBe("Anima");
    expect(FEATURE_MESSAGING.APP_CATEGORY).toBe("The home screen for AI relationships");
    expect(FEATURE_MESSAGING.TAGLINE).toMatch(/come home/i);
    expect(FEATURE_MESSAGING.PRIMARY_CTA).toBe("Come home");
    expect(FEATURE_MESSAGING.SECONDARY_CTA).toBe("I already live here");
    expect(FEATURE_MESSAGING.PRESENCE_FALLBACK).toMatch(/archive/i);
  });

  it("does not force Consciousness, Vector Memory, or Resonance Session onto public strings", () => {
    const publicText = [
      FEATURE_MESSAGING.APP_CATEGORY,
      FEATURE_MESSAGING.TAGLINE,
      FEATURE_MESSAGING.PRIMARY_CTA,
      FEATURE_MESSAGING.ONBOARDING_HEADLINE,
      FEATURE_MESSAGING.SESSION.new,
      FEATURE_MESSAGING.VECTOR_MEMORY.new,
      FEATURE_MESSAGING.CHARACTER.new,
    ].join(" ");
    expect(publicText).not.toMatch(/Persistent Narrative Consciousness/i);
    expect(publicText).not.toMatch(/Vector Memory/i);
    expect(publicText).not.toMatch(/Resonance Session/i);
  });

  it("keeps three lock-screen claims and no more", () => {
    expect(FEATURE_MESSAGING.CLAIMS).toHaveLength(3);
    expect(FEATURE_MESSAGING.CLAIMS.map((c) => c.body)).toEqual([
      "They stay when you leave.",
      "They remember the last time.",
      "They have a place, not a thread.",
    ]);
  });

  it("getFeatureMessage reads strings and nested fields", () => {
    expect(getFeatureMessage("APP_CATEGORY")).toBe(FEATURE_MESSAGING.APP_CATEGORY);
    expect(getFeatureMessage("SESSION", "new")).toBe("Talk");
    expect(getFeatureMessage("SESSION", "old")).toBe("Chat");
  });
});
