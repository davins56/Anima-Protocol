/**
 * Bond tier with the active companion. Same thresholds and names as the app's
 * RESONANCE_TIERS (artifacts/anima-protocol/src/hooks/useResonance.js).
 * The API derives the score on the server; the client never sends a tier.
 */
export type BondTier = "distant" | "attuned" | "bonded" | "resonant" | "entwined";

export const BOND_TIERS: readonly { tier: BondTier; min: number }[] = [
  { tier: "distant", min: 0 },
  { tier: "attuned", min: 25 },
  { tier: "bonded", min: 50 },
  { tier: "resonant", min: 75 },
  { tier: "entwined", min: 92 },
];

export function bondTierForScore(score: unknown): BondTier {
  const n = typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  let out: BondTier = "distant";
  for (const t of BOND_TIERS) if (n >= t.min) out = t.tier;
  return out;
}

export function bondTierRank(tier: BondTier): number {
  return BOND_TIERS.findIndex((t) => t.tier === tier);
}

export function isBondTier(v: unknown): v is BondTier {
  return typeof v === "string" && BOND_TIERS.some((t) => t.tier === v);
}
