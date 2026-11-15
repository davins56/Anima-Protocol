/**
 * Resonance-dependent decision. Two inputs:
 *  - bond tier (server-derived) decides which options are AVAILABLE;
 *  - tuned W (the FrequencyTuner value) against the gate's band decides how the
 *    chosen option LANDS (clean / partial / dissonant), using sim-core bands.
 *
 * `corruptionEligible` only reports that the outcome would qualify under the
 * memory-corruption design in #757. Nothing here (or in the slice) corrupts
 * memory; that is not built until Dàvīn approves the design.
 */
import { bandAt, bandDistance, clarityAt, clampW, type BandKey } from "@workspace/sim-core";
import { bondTierRank, type BondTier } from "./bond";
import type { LoreText } from "./lore";

export type DecisionOption = {
  readonly id: string;
  readonly label: LoreText;
  /** Lowest bond tier that unlocks this option. */
  readonly minTier: BondTier;
};

export type DecisionGate = {
  readonly id: string;
  readonly band: BandKey;
  readonly prompt: LoreText;
  readonly options: readonly DecisionOption[];
};

export type DecisionOutcome = "clean" | "partial" | "dissonant";

export type DecisionResult =
  | {
      ok: true;
      optionId: string;
      tunedW: number;
      band: BandKey;
      bandGap: number;
      clarity: number;
      outcome: DecisionOutcome;
      corruptionEligible: boolean;
    }
  | { ok: false; code: "unknown_option" | "option_locked" | "invalid_w" };

export function availableOptions(gate: DecisionGate, tier: BondTier): DecisionOption[] {
  const rank = bondTierRank(tier);
  return gate.options.filter((o) => bondTierRank(o.minTier) <= rank);
}

export function outcomeForGap(gap: number): DecisionOutcome {
  if (gap <= 0) return "clean";
  if (gap === 1) return "partial";
  return "dissonant";
}

export function resolveDecision(
  gate: DecisionGate,
  input: { optionId: string; tunedW: unknown; tier: BondTier },
): DecisionResult {
  const option = gate.options.find((o) => o.id === input.optionId);
  if (!option) return { ok: false, code: "unknown_option" };
  if (!availableOptions(gate, input.tier).includes(option)) return { ok: false, code: "option_locked" };
  if (typeof input.tunedW !== "number" || !Number.isFinite(input.tunedW)) return { ok: false, code: "invalid_w" };
  const w = clampW(input.tunedW);
  const band = bandAt(w).key;
  const bandGap = bandDistance(band, gate.band);
  const outcome = outcomeForGap(bandGap);
  return {
    ok: true,
    optionId: option.id,
    tunedW: Math.round(w * 10) / 10,
    band,
    bandGap,
    clarity: Math.round(clarityAt(w) * 1000) / 1000,
    outcome,
    corruptionEligible: outcome === "dissonant",
  };
}
