import { describe, expect, it } from "vitest";
import {
  applyTone,
  battleModsFor,
  clampMods,
  deriveBattle,
  narrate,
  readProfile,
  SEED_LIBRARY,
  stanceLine,
  TONES,
  toneFromSnapshot,
  validateOverride,
  autoProfile,
} from "../src/index";

const lib = SEED_LIBRARY;
const inBudget = (m: ReturnType<typeof clampMods>) => {
  for (const k of ["strike", "weapon", "guard", "speed"] as const) {
    expect(Number.isFinite(m[k])).toBe(true);
    expect(m[k]).toBeGreaterThanOrEqual(0.85);
    expect(m[k]).toBeLessThanOrEqual(1.15);
  }
  expect(Number.isInteger(m.control)).toBe(true);
  expect(m.control).toBeGreaterThanOrEqual(0);
  expect(m.control).toBeLessThanOrEqual(3);
};

describe("±15% budget (D4, K4)", () => {
  it("style plus tone stays inside the budget for every style × tone", () => {
    for (const s of lib.styles) for (const tone of TONES) inBudget(applyTone(deriveBattle(s), tone));
  });

  it("holds at the extremes: maxed axes plus the strongest tone", () => {
    const maxed = { id: "x", kind: "weapon" as const, range: "clinch" as const, axes: { aggression: 3, patience: 0, precision: 3, flow: 3, control: 3, cunning: 3, grit: 3, tradition: 3, pragmatism: 3, rhythm: 3 } };
    for (const tone of TONES) inBudget(applyTone(deriveBattle(maxed), tone));
    const minned = { ...maxed, axes: { aggression: 0, patience: 3, precision: 0, flow: 0, control: 3, cunning: 0, grit: 3, tradition: 0, pragmatism: 0, rhythm: 0 } };
    for (const tone of TONES) inBudget(applyTone(deriveBattle(minned), tone));
  });

  it("clamps hand-edited, legacy, NaN and malformed values to a defined result", () => {
    inBudget(clampMods({ strike: 9, weapon: -4, guard: NaN, control: 99, speed: Infinity }));
    expect(clampMods(null)).toEqual({ strike: 1, weapon: 1, guard: 1, control: 0, speed: 1, weaponChips: [] });
    expect(clampMods({ weaponChips: ["cannon", "cannon", "nuke", 3] }).weaponChips).toEqual(["cannon"]);
    expect(clampMods("garbage").strike).toBe(1);
  });

  it("unknown ids give the neutral result plus the composed tone only", () => {
    const m = battleModsFor(lib, { style_id: "jeet_kune_do" }, "fierce");
    expect(m).toEqual(clampMods({}));
    expect(battleModsFor(lib, { style_id: "boxing", variant_id: "nope" })).toEqual(clampMods({}));
  });

  it("guard is an incoming-damage multiplier (below 1 = takes less)", () => {
    expect(deriveBattle(lib.byId.get("taijiquan")!).guard).toBeLessThan(1);
    expect(applyTone(deriveBattle(lib.byId.get("taijiquan")!), "guarded").guard).toBeLessThan(deriveBattle(lib.byId.get("taijiquan")!).guard);
  });
});

describe("tone from the public affect layer only (K3)", () => {
  it("is composed with emotions off, no snapshot, or a non-public layer", () => {
    const hostile = { layer: "public", primary: "hostile" };
    expect(toneFromSnapshot(hostile, { emotionsEnabled: false })).toBe("composed");
    expect(toneFromSnapshot(null, { emotionsEnabled: true })).toBe("composed");
    expect(toneFromSnapshot({ ...hostile, layer: "composed" }, { emotionsEnabled: true })).toBe("composed");
    expect(toneFromSnapshot({ primary: "hostile" }, { emotionsEnabled: true })).toBe("composed");
  });

  it("ignores private fields (focus, intent, openLoops, cause)", () => {
    const snap = { layer: "public", primary: "content", focus: "hostile", intent: "fearful", openLoops: ["x"], cause: "memory text", selfState: { primary: "hostile" } };
    expect(toneFromSnapshot(snap as never, { emotionsEnabled: true })).toBe("composed");
  });

  it("maps public dims and labels to tones", () => {
    const on = { emotionsEnabled: true };
    expect(toneFromSnapshot({ layer: "public", dims: { stability: 0.1 } }, on)).toBe("shaken");
    expect(toneFromSnapshot({ layer: "public", dims: { arousal: 0.8, valence: -0.4 } }, on)).toBe("fierce");
    expect(toneFromSnapshot({ layer: "public", dims: { dominance: -0.5 } }, on)).toBe("guarded");
    expect(toneFromSnapshot({ layer: "public", primary: "playful" }, on)).toBe("playful");
  });
});

describe("narration and stance (§5)", () => {
  const pick = { style_id: "wing_chun", variant_id: "yip_man_lineage" };
  it("narrates navi actions only, deterministically, as plain text without numbers or tone words", () => {
    const a = narrate(lib, { type: "hit", sourceId: "navi", seq: 7 }, pick, "guarded");
    expect(a).toBe(narrate(lib, { type: "hit", sourceId: "navi", seq: 7 }, pick, "guarded"));
    expect(a).not.toMatch(/\d|guarded|fierce|shaken|playful|composed|<|>/i);
    expect(narrate(lib, { type: "hit", sourceId: "mettaur-1", seq: 7 }, pick)).toBeNull();
    expect(narrate(lib, { type: "damage", seq: 7 }, pick)).toBeNull();
    expect(narrate(lib, { type: "hit", sourceId: "navi" }, { style_id: "unknown" })).toBeNull();
  });

  it("every style has a stance line and narration", () => {
    for (const s of lib.styles) {
      expect(stanceLine(lib, { style_id: s.id, variant_id: null })).toMatch(/settles into/);
      expect(narrate(lib, { type: "chip_used", unitId: "navi", seq: 1 }, { style_id: s.id, variant_id: null })).toBeTruthy();
    }
  });
});

describe("profiles (§3, §6)", () => {
  it("override validation returns the agreed error codes", () => {
    expect(validateOverride(lib, { style_id: "nope" }, null)).toMatchObject({ ok: false, error: "unknown_style" });
    expect(validateOverride(lib, { style_id: "boxing", variant_id: "nope" }, null)).toMatchObject({ ok: false, error: "unknown_variant" });
    expect(validateOverride(lib, { style_id: "boxing" }, { style_id: "boxing" })).toMatchObject({ ok: false, error: "same_style" });
    expect(validateOverride(lib, { style_id: "boxing" }, { style_id: "judo", variant_id: "ne_waza" })).toMatchObject({ ok: true });
  });

  it("read validation: unknown ids → null; bad explanation is regenerated", () => {
    const p = autoProfile({ lib, inputs: { personality: "calm patient" }, characterId: "c", rev: 1, now: "2026-11-15T00:00:00.000Z" });
    expect(readProfile(lib, p)).toEqual(p);
    expect(readProfile(lib, { ...p, primary: { style_id: "removed_style" } })).toBeNull();
    expect(readProfile(lib, [])).toBeNull();
    const fixed = readProfile(lib, { ...p, explanation: "<script>x</script>", rev: 1e20 });
    expect(fixed?.explanation).not.toMatch(/</);
    expect(fixed?.rev).toBe(0);
  });
});
