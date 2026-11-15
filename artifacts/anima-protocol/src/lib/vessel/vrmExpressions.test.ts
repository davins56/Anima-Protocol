import { describe, expect, it } from "vitest";
import { availableVrmPresets, createBlinker, easeWeights, expressionToVrmWeights, moodToVrmWeights } from "./vrmExpressions";
import { expressionFor } from "./emotion";
import { MOODS } from "@/lib/moodDetector";

describe("availableVrmPresets", () => {
  it("keeps VRM 1.0 presets and aliases VRM 0.x blend shapes", () => {
    expect([...availableVrmPresets(["happy", "Blink", "aa", "MyCustom"])!].sort()).toEqual(["aa", "blink", "happy"]);
    expect([...availableVrmPresets(["Joy", "Sorrow", "Fun", "A", "O", "Blink_L"])!].sort()).toEqual(["aa", "happy", "oh", "relaxed", "sad"]);
    expect(availableVrmPresets(undefined)).toBeNull();
  });
});

describe("moodToVrmWeights", () => {
  const all = availableVrmPresets(["happy", "angry", "sad", "relaxed", "surprised", "neutral", "blink"]);
  it("maps every chat mood to a known preset", () => {
    for (const mood of Object.keys(MOODS)) {
      const w = moodToVrmWeights(mood, 8, all);
      expect(Object.keys(w).length, mood).toBeGreaterThan(0);
      for (const v of Object.values(w)) expect(v).toBeGreaterThan(0);
    }
    expect(moodToVrmWeights("happy", 10, all).happy).toBeCloseTo(0.85);
    expect(moodToVrmWeights("hostile", 10, all).angry).toBeGreaterThan(0.8);
    expect(moodToVrmWeights("sad", 100, all).sad).toBeGreaterThan(0.7);
  });
  it("scales with intensity (0-10 or 0-100)", () => {
    expect(moodToVrmWeights("happy", 2, all).happy!).toBeLessThan(moodToVrmWeights("happy", 9, all).happy!);
    expect(moodToVrmWeights("happy", 90, all).happy).toBeCloseTo(moodToVrmWeights("happy", 9, all).happy!);
  });
  it("only drives presets the model declares", () => {
    const onlySad = availableVrmPresets(["Sorrow"]);
    expect(moodToVrmWeights("happy", 10, onlySad)).toEqual({});
    expect(Object.keys(moodToVrmWeights("anxious", 10, onlySad))).toEqual(["sad"]);
    // no metadata → unrestricted
    expect(moodToVrmWeights("happy", 10, null).happy).toBeGreaterThan(0);
    expect(moodToVrmWeights("unknown-mood", 10, all)).toEqual(moodToVrmWeights("neutral", 10, all));
  });
});

describe("expressionToVrmWeights", () => {
  const all = availableVrmPresets(["happy", "angry", "sad", "relaxed", "surprised"]);
  it("reads the procedural face weights", () => {
    expect(expressionToVrmWeights(expressionFor("happy", 10), all).happy).toBeGreaterThan(0.5);
    expect(expressionToVrmWeights(expressionFor("sad", 10), all).sad).toBeGreaterThan(0.3);
    expect(expressionToVrmWeights(expressionFor("hostile", 10), all).angry).toBeGreaterThan(0.3);
    expect(expressionToVrmWeights(expressionFor("neutral", 10), all)).toEqual({});
  });
});

describe("easeWeights", () => {
  it("moves toward target frame-rate independently and decays dropped presets", () => {
    const a = easeWeights({}, { happy: 1 }, 0.2, 0.2);
    expect(a.happy).toBeCloseTo(0.5);
    const two = easeWeights(easeWeights({}, { happy: 1 }, 0.1, 0.2), { happy: 1 }, 0.1, 0.2);
    expect(two.happy).toBeCloseTo(0.5);
    const back = easeWeights({ happy: 0.5 }, {}, 0.2, 0.2);
    expect(back.happy).toBeCloseTo(0.25);
    expect(easeWeights({ happy: 0.0005 }, {}, 1)).toEqual({});
  });
});

describe("createBlinker", () => {
  it("blinks briefly every few seconds and damps while smiling", () => {
    const b = createBlinker(() => 0); // first blink at 2s, every 2s
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) samples.push(b.update(0.01));
    const closed = samples.filter((w) => w > 0.5).length;
    expect(closed).toBeGreaterThan(3);
    expect(closed).toBeLessThan(40);
    expect(samples.slice(0, 190).every((w) => w === 0)).toBe(true);
    const h = createBlinker(() => 0);
    let peak = 0;
    for (let i = 0; i < 230; i++) peak = Math.max(peak, h.update(0.01, 1));
    expect(peak).toBeLessThanOrEqual(0.21);
  });
});
