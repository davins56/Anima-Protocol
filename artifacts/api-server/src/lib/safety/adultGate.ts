/**
 * Pure server decision for adult mode on a chat turn. Order matters:
 * therapy and crossover scenes are never adult (P1-11), and no client flag
 * can turn adult on without a server-stored age attestation.
 */
export type AdultGateInput = {
  therapy: boolean;
  /** Server-derived crossover (group with ≥ 2 universes) or client-declared. */
  crossover: boolean;
  ageAttested: boolean;
  /** profile.settings.adult_content_enabled */
  settingEnabled: boolean;
  /** body.metadata.adult_mode (client hint only) */
  requested: boolean;
};

export type AdultGateReason = "therapy" | "crossover" | "not_attested" | "not_requested" | "allowed";

export function adultGate(i: AdultGateInput): { adult: boolean; reason: AdultGateReason } {
  if (i.therapy) return { adult: false, reason: "therapy" };
  if (i.crossover) return { adult: false, reason: "crossover" };
  if (!i.settingEnabled && !i.requested) return { adult: false, reason: "not_requested" };
  if (!i.ageAttested) return { adult: false, reason: "not_attested" };
  return { adult: true, reason: "allowed" };
}
