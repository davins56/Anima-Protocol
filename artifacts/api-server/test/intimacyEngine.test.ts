import { describe, expect, it } from "vitest";
import { evaluateTurn, containsPhrase } from "../src/lib/intimacyEngine";
import type { IntimacyProfile, IntimacyScene } from "../src/lib/intimacyTypes";

const profile = (over: Partial<IntimacyProfile> = {}): IntimacyProfile =>
  ({
    userId: "u",
    characterId: "c",
    intimacyEnabled: true,
    heat: 0,
    safeword: "red",
    preferredPace: "slow",
    limits: [],
    softLimits: [],
    kinks: [],
    ...over,
  }) as IntimacyProfile;

describe("intimacy heat", () => {
  it("does not treat words containing 'red' as the safeword", () => {
    const r = evaluateTurn({
      profile: profile(),
      content: "I shivered as you whispered my name, desire covered me",
      adultEnabled: true,
    });
    expect(r.events).not.toContain("safeword");
    expect(r.heat).toBeGreaterThan(0);
  });

  it("still honours the whole-word safeword", () => {
    const r = evaluateTurn({ profile: profile({ heat: 60 }), content: "Red. Stop.", adultEnabled: true });
    expect(r.events).toContain("safeword");
    expect(r.heat).toBe(15);
  });

  it("raises heat on sensual language beyond the old keyword list", () => {
    const r = evaluateTurn({
      profile: profile(),
      content: "the soft fabric of my thong under your gaze sends shivers down my spine",
      adultEnabled: true,
    });
    expect(r.heat).toBeGreaterThanOrEqual(20);
  });

  it("leaves aftercare when the scene re-escalates", () => {
    const scene = { id: "s", conversationId: "x", characterId: "c", userId: "u", phase: "aftercare", heatPeak: 60, actsLog: [] } as IntimacyScene;
    const r = evaluateTurn({ profile: profile({ heat: 15 }), scene, content: "kiss me, I want you", adultEnabled: true });
    expect(r.phase).not.toBe("aftercare");
    expect(r.heat).toBeGreaterThan(15);
  });

  it("stays off without the adult gate", () => {
    const r = evaluateTurn({ profile: profile(), content: "naked", adultEnabled: false });
    expect(r.heat).toBe(0);
  });

  it("matches phrases on word boundaries", () => {
    expect(containsPhrase("bored and tired", "red")).toBe(false);
    expect(containsPhrase("okay, red!", "red")).toBe(true);
  });
});
