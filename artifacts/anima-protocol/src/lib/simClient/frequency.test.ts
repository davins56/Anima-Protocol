import { describe, expect, it } from "vitest";
import { LAYER_W, MAX_PHASE_DW } from "@workspace/sim-core";
import { RESONANCE_SPECTRUM } from "@/styles/anima-tokens";
import { bandForW, dialToPhaseTarget, layerPhaseTarget, phaseStepTarget, shouldCommitDial, tiltToW } from "./frequency";

describe("band lookup", () => {
  it("maps W to the five bands at their boundaries", () => {
    const cases: Array<[number, string]> = [
      [0, "noise"], [19.9, "noise"], [20, "ambient"], [44.9, "ambient"], [45, "data"],
      [74.9, "data"], [75, "rare"], [87.9, "rare"], [88, "serenity"], [100, "serenity"], [-5, "noise"], [130, "serenity"],
    ];
    for (const [w, key] of cases) expect(bandForW(w).key, `W=${w}`).toBe(key);
  });
  it("agrees with the design-token spectrum the FrequencyTuner draws", () => {
    for (const b of RESONANCE_SPECTRUM) {
      expect(bandForW(b.min).key).toBe(b.key);
      expect(bandForW((b.min + b.max) / 2).color.toLowerCase()).toBe(b.color.toLowerCase());
    }
  });
});

describe("dial → phase-shift target", () => {
  it("passes through targets within range, rounded to 0.1", () => {
    expect(dialToPhaseTarget(72.345, 60)).toBe(72.3);
  });
  it("clamps to the engine's ±MAX_PHASE_DW per shift", () => {
    expect(dialToPhaseTarget(100, 10)).toBe(10 + MAX_PHASE_DW);
    expect(dialToPhaseTarget(0, 94)).toBe(94 - MAX_PHASE_DW);
  });
  it("ignores aims inside the dead zone", () => {
    expect(dialToPhaseTarget(60.3, 60)).toBeNull();
  });
  it("steps to neighbouring layer centres and stops at the ends", () => {
    expect(phaseStepTarget(60, 1)).toBe(LAYER_W[3]);
    expect(phaseStepTarget(60, -1)).toBe(LAYER_W[1]);
    expect(phaseStepTarget(5, -1)).toBeNull();
    expect(phaseStepTarget(99, 1)).toBeNull();
  });
  it("layer taps beyond range shift as far as allowed", () => {
    expect(layerPhaseTarget(4, 10)).toBe(55);
  });
  it("device tilt maps ±35° to ±50 W around the base", () => {
    expect(tiltToW(0, 60)).toBe(60);
    expect(tiltToW(35, 60)).toBe(100);
    expect(tiltToW(-17.5, 60)).toBe(35);
    expect(tiltToW(90, 20)).toBe(70);
  });
  it("commits only after the dial settles and the navi is free", () => {
    const base = { dialW: 80, currentW: 60, lastMoveAt: 1000, busy: false };
    expect(shouldCommitDial({ ...base, now: 1100 })).toBeNull();
    expect(shouldCommitDial({ ...base, now: 1400 })).toBe(80);
    expect(shouldCommitDial({ ...base, now: 1400, busy: true })).toBeNull();
  });
});
