import { describe, expect, it } from "vitest";
import {
  advance,
  bandAt,
  clarityAt,
  createSim,
  CORRUPTION_COOLDOWN_TICKS,
  LAYER_W,
  layerAt,
  MAX_CORRUPTIONS_PER_BATTLE,
  replay,
  stateHash,
  step,
  validateLog,
  type SimConfig,
  type SimState,
  type StampedAction,
} from "../src/index";

const base: SimConfig = {
  seed: 42,
  companionId: "serenity",
  startW: 94,
  enemies: [{ kind: "mettaur", band: "noise" }],
  memoryPool: ["m1", "m2", "m3", "m4"],
};

function run(state: SimState, actions: StampedAction[]) {
  let s = state;
  const events = [];
  for (const a of actions) {
    const r = step(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

const pickAll = (tick: number): StampedAction[] => [
  { tick, action: { t: "custom_open" } },
  { tick, action: { t: "custom_pick", picks: [0, 1, 2, 3, 4] } },
];

describe("W axis", () => {
  it("bands match the design tokens", () => {
    expect([0, 19.9, 20, 44.9, 45, 74.9, 75, 87.9, 88, 100].map((w) => bandAt(w).key)).toEqual([
      "noise", "noise", "ambient", "ambient", "data", "data", "rare", "rare", "serenity", "serenity",
    ]);
  });
  it("clarity is continuous (no detents) and clear on violet, noisy on red", () => {
    expect(clarityAt(94)).toBe(1);
    expect(clarityAt(5)).toBeCloseTo(0.15);
    for (let w = 0; w < 100; w += 0.25) expect(Math.abs(clarityAt(w + 0.25) - clarityAt(w))).toBeLessThan(0.02);
  });
});

describe("determinism", () => {
  it("same config + inputs → same hash; replay agrees with live play", () => {
    const actions: StampedAction[] = [
      ...pickAll(0),
      { tick: 3, action: { t: "move", dc: 0, dr: -1 } },
      { tick: 10, action: { t: "chip" } },
      { tick: 30, action: { t: "phase", toW: 60 } },
      { tick: 80, action: { t: "buster" } },
    ];
    const live = run(createSim(base), actions);
    const again = replay(base, actions);
    expect(stateHash(again.state)).toBe(stateHash(live.state));
    expect(stateHash(replay({ ...base, seed: 7 }, actions).state)).not.toBe(stateHash(live.state));
  });
  it("does not mutate the input state", () => {
    const s0 = createSim(base);
    const h = stateHash(s0);
    step(s0, { tick: 40, action: { t: "move", dc: 1, dr: 0 } });
    expect(stateHash(s0)).toBe(h);
  });
});

describe("consequence propagation", () => {
  it("cracked panel breaks when the navi steps off it, then reverts", () => {
    let s = createSim(base);
    s.panels[layerAt(94)][1][1] = { kind: "cracked", until: null };
    s = step(s, { tick: 1, action: { t: "move", dc: 1, dr: 0 } }).state;
    expect(s.panels[layerAt(94)][1][1].kind).toBe("broken");
    expect(step(s, { tick: 2, action: { t: "move", dc: -1, dr: 0 } }).events.some((e) => e.type === "rejected")).toBe(true);
    s = advance(s, 200).state;
    expect(s.panels[layerAt(94)][1][1].kind).toBe("normal");
  });

  it("chips spend memory, double off-band", () => {
    let s = createSim({ ...base, folder: ["cannon", "cannon", "cannon", "cannon", "cannon"] });
    s = run(s, pickAll(0)).state;
    const m0 = s.memory;
    s = step(s, { tick: 1, action: { t: "chip" } }).state; // data chip used on serenity band → off-band
    expect(m0 - s.memory).toBe(8);
  });

  it("PhaseGate opens a portal that makes the next W shift instant and free, then closes", () => {
    let s = createSim({ ...base, startW: 60, folder: Array(5).fill("phase_gate") });
    s = run(s, pickAll(0)).state;
    s = step(s, { tick: 1, action: { t: "chip" } }).state;
    expect(s.portals).toHaveLength(1);
    const mem = s.memory;
    const r = step(s, { tick: 2, action: { t: "phase", toW: LAYER_W[3] } });
    expect(r.state.memory).toBe(mem);
    s = advance(r.state, 4).state;
    expect(layerAt(s.units[0].w)).toBe(3);
    expect(s.portals).toHaveLength(0);
  });

  it("a phasing navi is intangible; landing moves her layer", () => {
    let s = createSim(base);
    s = step(s, { tick: 1, action: { t: "phase", toW: 60 } }).state;
    expect(s.units[0].phase).not.toBeNull();
    s = advance(s, 40).state;
    expect(s.units[0].phase).toBeNull();
    expect(bandAt(s.units[0].w).key).toBe("data");
  });

  it("mismatched virus hits corrupt memory — appended, rate-limited, capped, restorable by Purify", () => {
    // Serenity on violet vs a noise virus: band distance 4 ⇒ mismatch.
    let s = createSim({ ...base, enemies: [{ kind: "shade", band: "noise", w: 94, hp: 9999 }], playerHp: 9999 });
    s = advance(s, 3000).state;
    expect(s.corruptions.length).toBeGreaterThan(0);
    expect(s.corruptions.length).toBeLessThanOrEqual(MAX_CORRUPTIONS_PER_BATTLE);
    const ticks = s.corruptions.map((c) => c.tick);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(CORRUPTION_COOLDOWN_TICKS);
    expect(new Set(s.corruptions.map((c) => c.targetEventId)).size).toBe(s.corruptions.length);

    s = { ...s, custom: { gauge: 1, open: false, offer: [] }, folder: Array(5).fill("purify"), memory: 100 };
    s.units[0].phase = null;
    s.units[0].w = 94;
    s = run(s, pickAll(s.tick)).state;
    const r = step(s, { tick: s.tick, action: { t: "purify" } });
    expect(r.events.some((e) => e.type === "memory_restored")).toBe(true);
    expect(r.state.corruptions.filter((c) => c.restored)).toHaveLength(1);
  });

  it("purify fizzles on a noisy signal", () => {
    let s = createSim({ ...base, startW: 10, folder: Array(5).fill("purify") });
    s = run(s, pickAll(0)).state;
    expect(step(s, { tick: 1, action: { t: "purify" } }).events.some((e) => e.type === "rejected")).toBe(true);
  });

  it("clarity scales damage: the same Cannon hits harder on violet than on red", () => {
    const dmg = (w: number) => {
      let s = createSim({ ...base, startW: w, folder: Array(5).fill("cannon"), enemies: [{ kind: "m", band: "data", w, row: 1, hp: 500 }] });
      s = run(s, pickAll(0)).state;
      const r = step(s, { tick: 1, action: { t: "chip" } });
      return r.events.filter((e) => e.type === "damage").reduce((n, e) => n + (e.type === "damage" ? e.amount : 0), 0);
    };
    expect(dmg(94)).toBeGreaterThan(dmg(10));
  });

  it("deleting the last virus wins and propagates through the bus with causal links", () => {
    let s = createSim({ ...base, startW: 60, folder: Array(5).fill("cannon"), enemies: [{ kind: "m", band: "data", row: 1, hp: 10 }] });
    s = run(s, pickAll(0)).state;
    const r = step(s, { tick: 1, action: { t: "chip" } });
    expect(r.state.outcome).toBe("win");
    const end = r.events.find((e) => e.type === "battle_end")!;
    expect(end.depth).toBeGreaterThanOrEqual(3); // chip_used → hit → damage → unit_defeated → battle_end
    expect(end.cause).not.toBeNull();
  });
});

describe("validateLog (anti-cheat lite)", () => {
  const actions: StampedAction[] = [...pickAll(0), { tick: 5, action: { t: "chip" } }, { tick: 50, action: { t: "buster" } }];
  it("accepts an honest log and its hash", () => {
    const { state } = replay(base, actions, 60);
    const v = validateLog(base, actions, { tick: 60, hash: stateHash(state) });
    expect(v.ok).toBe(true);
  });
  it("rejects a forged hash, out-of-order ticks, malformed and superhuman input", () => {
    expect(validateLog(base, actions, { tick: 60, hash: "deadbeef" }).ok).toBe(false);
    expect(validateLog(base, [{ tick: 5, action: { t: "buster" } }, { tick: 4, action: { t: "buster" } }]).ok).toBe(false);
    expect(validateLog(base, [{ tick: 1, action: { t: "move", dc: 3, dr: 0 } }]).ok).toBe(false);
    expect(validateLog(base, Array.from({ length: 30 }, (_, i) => ({ tick: Math.floor(i / 3), action: { t: "buster" as const } }))).ok).toBe(false);
  });
});

import { glitchText, obscuredMemory } from "../src/index";
describe("glitch view", () => {
  it("is deterministic, proportional and non-destructive", () => {
    const t = "we watched the meteor shower from the roof and named one after her";
    expect(glitchText(t, 0)).toBe(t);
    expect(glitchText(t, 0.5, "x")).toBe(glitchText(t, 0.5, "x"));
    const lost = (s: string) => s.split(" ").filter((w) => /[▓▒░█]/.test(w)).length;
    expect(lost(glitchText(t, 0.9, "x"))).toBeGreaterThan(lost(glitchText(t, 0.2, "x")));
    expect(obscuredMemory(t, 0.4, "id")).toMatch(/^\[signal corrupted · 40%\]/);
  });
});
