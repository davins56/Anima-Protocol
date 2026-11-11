import { describe, expect, it } from "vitest";
import { createSim, step } from "@workspace/sim-core";
import { EMOTION_DIMENSIONS, moodToEmotion, NEUTRAL_EMOTION, simToEmotion, stepEmotion, emotionDistance } from "./emotionState";
import { COMPANION_TRAITS, GENERIC_TRAITS, traitsFor, SHIFT_PARAMS } from "./vesselTraits";
import { computeVesselShift, shiftKey } from "./emotionShift";

describe("emotion state", () => {
  it("maps moods into bounded dimensions, scaled by intensity", () => {
    const hi = moodToEmotion("fearful", 100);
    const lo = moodToEmotion("fearful", 20);
    expect(hi.arousal).toBeGreaterThan(lo.arousal);
    expect(hi.valence).toBeLessThan(lo.valence);
    for (const d of EMOTION_DIMENSIONS) expect(Number.isFinite(hi[d])).toBe(true);
    expect(moodToEmotion("not-a-mood")).toEqual(NEUTRAL_EMOTION);
  });

  it("eases toward the target and relaxes to baseline (frame-rate independent)", () => {
    const base = COMPANION_TRAITS.serenity.baseline;
    const target = moodToEmotion("hostile", 100);
    let a = base, b = base;
    for (let i = 0; i < 60; i++) a = stepEmotion(a, target, base, 1 / 60);
    for (let i = 0; i < 10; i++) b = stepEmotion(b, target, base, 1 / 10);
    expect(emotionDistance(a, b)).toBeLessThan(0.02);
    expect(emotionDistance(a, target)).toBeLessThan(emotionDistance(base, target));
    let r = a;
    for (let i = 0; i < 200; i++) r = stepEmotion(r, null, base, 0.1);
    expect(emotionDistance(r, base)).toBeLessThan(0.05);
  });

  it("net battle: low HP and corruption push valence down; a win lifts it", () => {
    const s0 = createSim({ seed: 1, companionId: "serenity", startW: 94, enemies: [{ kind: "m", band: "noise" }], memoryPool: ["a"] });
    const hurt = { ...s0, units: s0.units.map((u, i) => (i === 0 ? { ...u, hp: 20 } : u)), corruptions: [{ targetEventId: "a", tick: 1, severity: 0.5, band: "noise" as const, restored: false }] };
    expect(simToEmotion(hurt).valence).toBeLessThan(simToEmotion(s0).valence);
    expect(simToEmotion({ ...s0, outcome: "win" }).valence).toBeGreaterThan(0.7);
    expect(simToEmotion({ ...s0, units: s0.units.map((u, i) => (i === 0 ? { ...u, w: 5 } : u)) }).stability).toBeLessThan(simToEmotion(s0).stability);
    expect(step(s0, { tick: 1, action: { t: "buster" } }).state).toBeTruthy();
  });
});

describe("traits (data-driven, distinct identities)", () => {
  it("resolves built-ins by id or name, including Aeland's legacy spellings", () => {
    expect(traitsFor("serenity").id).toBe("serenity");
    expect(traitsFor({ name: "Scarlet" }).id).toBe("scarlet");
    for (const n of ["Aeland", "Aelynd", "Aelyndra", "aelindra"]) expect(traitsFor({ name: n }).id).toBe("aeland");
    expect(traitsFor({ id: "u_123", name: "Nova" })).toBe(GENERIC_TRAITS);
    expect(COMPANION_TRAITS.aeland.displayName).toBe("Aeland");
  });

  it("every effect targets a known param and dimension", () => {
    for (const t of [...Object.values(COMPANION_TRAITS), GENERIC_TRAITS])
      for (const fx of t.effects) {
        expect(SHIFT_PARAMS).toContain(fx.param);
        expect(EMOTION_DIMENSIONS).toContain(fx.from);
      }
  });

  it("Serenity and Scarlet never share a palette or aura", () => {
    const s = COMPANION_TRAITS.serenity, r = COMPANION_TRAITS.scarlet;
    expect(s.aura).toBe("celestial");
    expect(r.aura).toBe("flame");
    expect(new Set(Object.values(s.palette)).size + new Set(Object.values(r.palette)).size).toBe(
      new Set([...Object.values(s.palette), ...Object.values(r.palette)]).size,
    );
  });
});

describe("vessel shift", () => {
  it("Scarlet's flame rises with arousal and darkens with negative valence", () => {
    const t = COMPANION_TRAITS.scarlet;
    const calm = computeVesselShift({ ...t.baseline, arousal: 0.1 }, t);
    const fired = computeVesselShift({ ...t.baseline, arousal: 0.95 }, t);
    expect(fired.auraIntensity).toBeGreaterThan(calm.auraIntensity);
    expect(fired.particleRate).toBeGreaterThan(calm.particleRate);
    const sad = computeVesselShift({ ...t.baseline, valence: -0.9 }, t);
    expect(sad.lowMix).toBeGreaterThan(0.6);
    expect(sad.color).not.toBe(calm.color);
  });

  it("Serenity flickers only when her signal is unstable", () => {
    const t = COMPANION_TRAITS.serenity;
    expect(computeVesselShift({ ...t.baseline, stability: 1 }, t).flicker).toBeCloseTo(0);
    expect(computeVesselShift({ ...t.baseline, stability: 0.2 }, t).flicker).toBeGreaterThan(0.5);
  });

  it("reduced motion damps motion params; shiftKey quantises", () => {
    const t = COMPANION_TRAITS.scarlet;
    const e = { ...t.baseline, arousal: 1 };
    expect(computeVesselShift(e, t, { reducedMotion: true }).particleRate).toBeLessThan(computeVesselShift(e, t).particleRate);
    const a = computeVesselShift(e, t);
    const b = computeVesselShift({ ...e, arousal: 0.999 }, t);
    expect(shiftKey(a)).toBe(shiftKey(b));
  });
});
