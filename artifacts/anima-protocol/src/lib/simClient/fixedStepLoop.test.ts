import { describe, expect, it } from "vitest";
import { TICK_MS, validateLog, type SimAction, type SimConfig } from "@workspace/sim-core";
import { FixedStepLoop } from "./fixedStepLoop";
import { autopilot } from "./autopilot";

const config: SimConfig = {
  seed: 1337,
  companionId: "serenity",
  startW: 60,
  enemies: [
    { kind: "mettaur", band: "data", hp: 90 },
    { kind: "shade", band: "noise", hp: 70 },
  ],
  memoryPool: ["m1", "m2", "m3"],
};

/** Inputs keyed by the sim tick at which they are meant to apply. */
const SCRIPT: Array<[number, SimAction]> = [
  [1, { t: "custom_open" }],
  [1, { t: "custom_pick", picks: [0, 1, 2] }],
  [3, { t: "move", dc: 0, dr: -1 }],
  [6, { t: "buster" }],
  [9, { t: "chip" }],
  [16, { t: "move", dc: 1, dr: 0 }],
  [24, { t: "phase", toW: 32.5 }],
  [48, { t: "buster" }],
  [62, { t: "phase", toW: 60 }],
  [90, { t: "buster" }],
];

/**
 * Drive a loop with a given frame-time pattern. Inputs are queued from the
 * tick-boundary hook so each lands on its scripted tick regardless of how
 * frames slice real time (a real player's inputs are stamped the same way).
 */
function drive(frames: (i: number) => number, totalMs: number, script = SCRIPT) {
  const loop = new FixedStepLoop(config, { maxCatchUpSteps: 50, maxFrameMs: 10_000 });
  let next = 0;
  loop.beforeTick((s, l) => {
    while (next < script.length && script[next][0] <= s.tick + 1) l.enqueue(script[next++][1]);
  });
  let now = 0;
  for (let i = 0; now < totalMs; i++) {
    const dt = frames(i);
    now += dt;
    loop.update(dt);
  }
  return loop;
}

describe("FixedStepLoop", () => {
  it("steps exactly one tick per 50 ms of accumulated time and exposes alpha", () => {
    const loop = new FixedStepLoop(config);
    loop.update(20);
    expect(loop.curr.tick).toBe(0);
    expect(loop.alpha).toBeCloseTo(20 / TICK_MS);
    loop.update(35);
    expect(loop.curr.tick).toBe(1);
    expect(loop.alpha).toBeCloseTo(5 / TICK_MS);
    expect(loop.prev.tick).toBe(0);
  });

  it("clamps catch-up after a long stall and drops the remainder", () => {
    const loop = new FixedStepLoop(config, { maxCatchUpSteps: 5, maxFrameMs: 1000 });
    const steps = loop.update(5000);
    expect(steps).toBe(5);
    expect(loop.curr.tick).toBe(5);
    expect(loop.accumulator).toBeLessThan(TICK_MS);
    expect(loop.droppedTicks).toBeGreaterThan(0);
  });

  it("does not advance while paused and does not catch up on resume", () => {
    const loop = new FixedStepLoop(config);
    loop.update(100);
    const t = loop.curr.tick;
    loop.setPaused(true);
    loop.update(2000);
    expect(loop.curr.tick).toBe(t);
    loop.setPaused(false);
    loop.update(10);
    expect(loop.curr.tick).toBe(t);
  });

  it("is deterministic: same inputs → same state hash regardless of frame rate", () => {
    const at60 = drive(() => 1000 / 60, 6000);
    const at144 = drive(() => 1000 / 144, 6000);
    const jitter = drive((i) => [7, 33, 16, 49, 3, 21][i % 6], 6000);
    expect(at60.input.log).toEqual(at144.input.log);
    expect(at60.input.log).toEqual(jitter.input.log);
    // Compare at a common tick: step each to the same tick with fixed 50 ms frames.
    const tick = Math.max(at60.curr.tick, at144.curr.tick, jitter.curr.tick);
    for (const l of [at60, at144, jitter]) while (l.curr.tick < tick && !l.done) l.tickOnce();
    expect(at60.hash()).toBe(at144.hash());
    expect(at60.hash()).toBe(jitter.hash());
    expect(at60.curr.tick).toBe(tick);
  });

  it("live state matches a server-style replay of the stamped log", () => {
    const loop = drive(() => 1000 / 60, 6000);
    expect(loop.verifyReplay().ok).toBe(true);
    const v = validateLog(config, loop.input.log, { tick: loop.curr.tick, hash: loop.hash() });
    expect(v.ok).toBe(true);
  });

  it("autopilot battles stay replay-valid", () => {
    const loop = new FixedStepLoop({ ...config, seed: 7 });
    loop.beforeTick((s, l) => {
      if (s.tick % 3 === 0 && l.input.size === 0) for (const a of autopilot(s)) l.enqueue(a);
    });
    for (let i = 0; i < 1200 && !loop.done; i++) loop.update(TICK_MS);
    expect(loop.input.log.length).toBeGreaterThan(10);
    const v = validateLog(loop.config, loop.input.log, { tick: loop.curr.tick, hash: loop.hash() });
    expect(v.ok).toBe(true);
  });
});
