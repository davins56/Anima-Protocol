/**
 * Battle effects (§5, D4). Style plus tone combined stay within ±15%:
 * strike/weapon/guard ∈ [0.85, 1.15] (guard multiplies incoming damage), control
 * ∈ 0–3 integer ticks (≤ 15% of the shortest 20-tick enemy interval), and a
 * NetBattle-only speed ∈ [0.85, 1.15]. There is no 4D tempo knob: ±1 tick of a
 * 4-tick cooldown would be 25%.
 *
 * The server clamps when it writes `config.style`; sim-core clamps again on read
 * (K4). `clampMods` is the shared clamp both sides call, and it also cleans a
 * hand-edited or legacy value.
 */
import { CHIPS, type ChipId } from "@workspace/sim-core";
import type { BattleMods, MartialStyle, StyleRange, Tone } from "./types";

export const MOD_MIN = 0.85;
export const MOD_MAX = 1.15;
export const CONTROL_MAX = 3;

const RANGE_CHIPS: Record<StyleRange, ChipId[]> = {
  weapon: ["wide_sword"],
  long: ["cannon", "crack_shot"],
  mid: ["cannon"],
  close: [],
  clinch: [],
  ground: [],
};
/** Ranged weapon arts use the ranged chips instead of the blade chip. */
const STYLE_CHIPS: Record<string, ChipId[]> = {
  kyudo: ["cannon", "crack_shot", "resonance_lance"],
};

function clampNum(x: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof x === "number" && Number.isFinite(x) ? x : fallback;
  return Math.min(hi, Math.max(lo, n));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Round half to even, matching how the posted catalog was computed. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/**
 * Derive a style's battle effects from its axes, kind and range. User styles
 * go through exactly the same table, so a user style can never be stronger
 * than a seed style (§2.1).
 */
export function deriveBattle(style: Pick<MartialStyle, "id" | "kind" | "range" | "axes">): BattleMods {
  const a = style.axes;
  const strike = 1 + 0.03 * a.aggression + 0.01 * a.grit - 0.01 * a.patience;
  const guard = 1 - 0.025 * a.patience - 0.02 * a.control - 0.01 * a.grit + 0.015 * a.aggression;
  const weapon = 1 + (style.kind === "weapon" ? 0.04 * a.precision + 0.02 * a.flow : 0.01 * a.precision);
  const grappleRange = style.range === "clinch" || style.range === "ground" ? 1 : 0;
  const control = Math.min(CONTROL_MAX, roundHalfEven(a.control * 0.75 + grappleRange));
  const speed = 1 + 0.02 * a.flow + 0.015 * a.rhythm + 0.01 * a.precision - 0.01 * a.grit - 0.01 * a.control;
  return clampMods({
    strike: round3(strike),
    weapon: round3(weapon),
    guard: round3(guard),
    control,
    speed: round3(speed),
    weaponChips: STYLE_CHIPS[style.id] ?? RANGE_CHIPS[style.range] ?? [],
  });
}

/** Tone deltas (§5), added BEFORE the clamp so style plus tone never exceeds the budget. */
export const TONE_DELTAS: Record<Tone, Partial<Omit<BattleMods, "weaponChips">>> = {
  composed: { control: 1 },
  shaken: { guard: 0.03, control: -1 },
  fierce: { strike: 0.04, guard: 0.03 },
  guarded: { guard: -0.04, strike: -0.02 },
  playful: { weapon: 0.03, guard: 0.02 },
};

export function applyTone(mods: BattleMods, tone: Tone | null | undefined): BattleMods {
  const d = (tone && TONE_DELTAS[tone]) || {};
  return clampMods({
    strike: mods.strike + (d.strike ?? 0),
    weapon: mods.weapon + (d.weapon ?? 0),
    guard: mods.guard + (d.guard ?? 0),
    control: mods.control + (d.control ?? 0),
    speed: mods.speed + (d.speed ?? 0),
    weaponChips: mods.weaponChips,
  });
}

/** Clamp anything (including a hand-edited or legacy value) into the ±15% budget. */
export function clampMods(raw: unknown): BattleMods {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const chips = Array.isArray(r.weaponChips)
    ? (r.weaponChips.filter((c, i, all) => typeof c === "string" && c in CHIPS && all.indexOf(c) === i) as ChipId[])
    : [];
  return {
    strike: round3(clampNum(r.strike, MOD_MIN, MOD_MAX, 1)),
    weapon: round3(clampNum(r.weapon, MOD_MIN, MOD_MAX, 1)),
    guard: round3(clampNum(r.guard, MOD_MIN, MOD_MAX, 1)),
    control: Math.round(clampNum(r.control, 0, CONTROL_MAX, 0)),
    speed: round3(clampNum(r.speed, MOD_MIN, MOD_MAX, 1)),
    weaponChips: chips,
  };
}

export const NEUTRAL_MODS: BattleMods = Object.freeze({
  strike: 1,
  weapon: 1,
  guard: 1,
  control: 0,
  speed: 1,
  weaponChips: [] as ChipId[],
}) as BattleMods;
