import type { BandKey } from "./bands";
import type { ChipId } from "./types";

export type ChipSpec = {
  id: ChipId;
  name: string;
  band: BandKey;
  /** base damage before clarity/affinity scaling */
  power: number;
  /** memory resource cost (doubled when used off-band) */
  cost: number;
  blurb: string;
};

export const CHIPS: Record<ChipId, ChipSpec> = {
  cannon: { id: "cannon", name: "Cannon", band: "data", power: 40, cost: 4, blurb: "First enemy in your row, this layer." },
  wide_sword: { id: "wide_sword", name: "WideSword", band: "ambient", power: 70, cost: 6, blurb: "Column in front, all three rows." },
  crack_shot: { id: "crack_shot", name: "CrackShot", band: "noise", power: 30, cost: 3, blurb: "Hits the first enemy in row and cracks its panel." },
  poison_seed: { id: "poison_seed", name: "PoisonSeed", band: "noise", power: 0, cost: 5, blurb: "Poisons the enemy 3×3 on this layer." },
  holy_panel: { id: "holy_panel", name: "HolyPanel", band: "rare", power: 0, cost: 5, blurb: "Your panel halves incoming damage." },
  phase_gate: { id: "phase_gate", name: "PhaseGate", band: "data", power: 0, cost: 6, blurb: "Opens a shortcut from this cell to the next layer." },
  resonance_lance: { id: "resonance_lance", name: "ResonanceLance", band: "serenity", power: 60, cost: 10, blurb: "Pierces your row across every layer." },
  purify: { id: "purify", name: "Purify", band: "serenity", power: 0, cost: 8, blurb: "Restores a corrupted memory; cleanses poison. Needs clarity ≥ 80%." },
};

export const DEFAULT_FOLDER: ChipId[] = [
  "cannon", "cannon", "cannon", "wide_sword", "wide_sword", "crack_shot", "crack_shot", "poison_seed",
  "holy_panel", "phase_gate", "phase_gate", "resonance_lance", "purify", "purify", "cannon",
];

export const HAND_OFFER = 5;
export const HAND_MAX = 5;
export const PURIFY_MIN_CLARITY = 0.8;

/** Damage multiplier for a chip band against a target's native band. */
export function affinity(chipBand: BandKey, targetBand: BandKey, distance: number): number {
  if (chipBand === targetBand) return 1.5;
  return distance <= 1 ? 1 : 0.7;
}
