/**
 * Heat meter: "Right-now intensity. Rises in the moment and cools when you
 * pause." Regression for Heat stuck at "Calm · 0" through a heated
 * conversation with Pulse on.
 */
import { describe, expect, it } from "vitest";
import {
  CALM_TURN_COOLING,
  INTENSITY_HALF_LIFE_MINUTES,
  SAFEWORD_CEILING,
  coolIntensity,
  currentIntensity,
  displayHeat,
  evolvePulseIntensity,
  lowerHeatTo,
  scoreHeatIntensity,
} from "../src/lib/heatIntensity";
import { evaluateTurn } from "../src/lib/intimacyEngine";
import type { IntimacyProfile } from "../src/lib/intimacyTypes";

const T0 = Date.parse("2026-11-13T23:00:00.000Z");
const at = (seconds: number) => T0 + seconds * 1000;

const profile = (over: Partial<IntimacyProfile> = {}): IntimacyProfile =>
  ({
    userId: "u",
    characterId: "natasha",
    intimacyEnabled: true,
    heat: 0,
    bondErotic: 0,
    powerAxis: 0,
    safeword: "red",
    preferredPace: "slow",
    anatomy: {},
    limits: [],
    softLimits: [],
    kinks: [],
    sceneCount: 0,
    aftercareStyle: "",
    ...over,
  }) as IntimacyProfile;

const HEATED: Array<[string, string]> = [
  ["You LIED to me, Natasha! How could you?!", "I did what I had to. Don't you dare act like you wouldn't have."],
  ["Don't you dare turn this around on me!!", "Then stop yelling and LISTEN to me!"],
  ["I'm so mad I'm shaking. You always do this.", "And you never let me explain!"],
  ["Fine. Explain. But I swear if you're lying again...", "I'm not. I need you to believe me."],
];

describe("heated conversation raises Heat from 0 (non-adult, Pulse on)", () => {
  it("climbs every heated turn and reads well above Calm", () => {
    let p = profile();
    expect(displayHeat(p, at(0))).toBe(0);
    let last = 0;
    HEATED.forEach(([user, reply], i) => {
      const now = at(i * 40);
      p = evolvePulseIntensity(p, { userText: user, replyText: reply, adult: false, now });
      const shown = displayHeat(p, now);
      expect(shown).toBeGreaterThan(last);
      last = shown;
    });
    // Out of "Calm" (<15) and "Stirring" into at least "Warm" (≥40).
    expect(last).toBeGreaterThanOrEqual(40);
    // The adult sensual heat was never touched.
    expect(p.heat).toBe(0);
  });

  it("names the signals it read", () => {
    const s = scoreHeatIntensity("WHY would you DO that?! I'm furious!", { sinceLastTurnMs: 20_000 });
    expect(s.signals).toEqual(expect.arrayContaining(["exclamation", "caps", "strong-emotion", "rapid"]));
    expect(s.gain).toBeGreaterThan(0);
  });

  it("calm small talk barely moves it and a calm turn cools it", () => {
    expect(scoreHeatIntensity("I had a sandwich for lunch", {}).gain).toBe(0);
    const warm = profile({ intensity: 30, intensityAt: new Date(at(0)).toISOString() });
    const next = evolvePulseIntensity(warm, { userText: "ok, what did you do today", now: at(50) });
    expect(next.intensity).toBe(30 - CALM_TURN_COOLING);
  });

  it("everyday words are not read as a fight", () => {
    expect(scoreHeatIntensity("I have to leave for work, talk later", {}).gain).toBe(0);
  });
});

describe("cools over a pause (time-based, not per render)", () => {
  it("halves per half-life of quiet, in whole minutes", () => {
    expect(coolIntensity(60, 0.9)).toBe(60);
    expect(coolIntensity(60, INTENSITY_HALF_LIFE_MINUTES)).toBe(30);
    expect(coolIntensity(60, INTENSITY_HALF_LIFE_MINUTES * 2)).toBe(15);
    expect(coolIntensity(60, 120)).toBe(0);
  });

  it("reading the meter does not cool it; elapsed time does", () => {
    const p = profile({ intensity: 64, intensityAt: new Date(at(0)).toISOString() });
    expect(currentIntensity(p, at(30))).toBe(64);
    expect(currentIntensity(p, at(30))).toBe(64);
    expect(currentIntensity(p, at(12 * 60))).toBe(16);
  });

  it("a heated turn after a long pause starts from the cooled value", () => {
    const p = profile({ intensity: 80, intensityAt: new Date(at(0)).toISOString() });
    const next = evolvePulseIntensity(p, { userText: "You LIED to me!", now: at(60 * 60) });
    expect(next.intensity).toBeLessThan(40);
    expect(next.intensity).toBeGreaterThan(0);
  });
});

describe("Pulse settings keep their meaning", () => {
  it("Pulse off: Heat is not computed at all", () => {
    const off = profile({ intimacyEnabled: false });
    expect(evolvePulseIntensity(off, { userText: "You LIED to me!!", now: at(0) })).toBe(off);
  });

  it("pace scales sensitivity the way it already scales sensual heat", () => {
    const line = { userText: "You LIED to me! How could you?!", now: at(0) };
    const slow = evolvePulseIntensity(profile({ preferredPace: "slow" }), line).intensity ?? 0;
    const build = evolvePulseIntensity(profile({ preferredPace: "build" }), line).intensity ?? 0;
    const intense = evolvePulseIntensity(profile({ preferredPace: "intense" }), line).intensity ?? 0;
    expect(build).toBeGreaterThan(slow);
    expect(intense).toBeGreaterThan(build);
  });

  it("typing the safeword (RED by default) cools the moment", () => {
    const hot = profile({ intensity: 90, intensityAt: new Date(at(0)).toISOString() });
    const next = evolvePulseIntensity(hot, { userText: "Red. Stop!!", now: at(10) });
    expect(next.intensity).toBe(SAFEWORD_CEILING);
    // Whole word only: "covered" is not the safeword.
    const still = evolvePulseIntensity(hot, { userText: "I'm covered in sweat and FURIOUS!", now: at(10) });
    expect(still.intensity).toBeGreaterThan(SAFEWORD_CEILING);
  });
});

describe("gates unchanged", () => {
  it("the safeword PATCH can only lower heat and intensity, never raise them", () => {
    const hot = profile({ heat: 60, intensity: 70, intensityAt: new Date(at(0)).toISOString() });
    const lowered = lowerHeatTo(hot, 15, at(1));
    expect(lowered.heat).toBe(15);
    expect(lowered.intensity).toBe(15);
    const cold = profile({ heat: 0, intensity: 0 });
    const attempt = lowerHeatTo(cold, 100, at(1));
    expect(attempt.heat).toBe(0);
    expect(attempt.intensity).toBe(0);
  });

  it("flirtation only counts when the adult gate is open", () => {
    expect(scoreHeatIntensity("you're gorgeous, come here", { adult: false }).signals).not.toContain("flirt");
    expect(scoreHeatIntensity("you're gorgeous, come here", { adult: true }).signals).toContain("flirt");
  });

  it("intensity never unlocks the adult scene: a gated user stays blocked at heat 0", () => {
    let p = profile();
    HEATED.forEach(([user, reply], i) => {
      p = evolvePulseIntensity(p, { userText: user, replyText: reply, adult: false, now: at(i * 40) });
    });
    expect(p.intensity).toBeGreaterThan(0);
    const gated = evaluateTurn({ profile: p, content: "kiss me, I want you", adultEnabled: false });
    expect(gated.blockIntimacy).toBe(true);
    expect(gated.phase).toBe("closed");
    expect(gated.heat).toBe(0);
  });

  it("adult scene phases still read sensual heat only, not intensity", () => {
    const p = profile({ intensity: 95, intensityAt: new Date().toISOString(), heat: 0 });
    const r = evaluateTurn({ profile: p, content: "I had a long day", adultEnabled: true });
    expect(r.heat).toBe(0);
    expect(r.phase).toBe("closed");
  });
});
