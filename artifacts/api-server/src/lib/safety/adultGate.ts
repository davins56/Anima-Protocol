/**
 * Pure server decision for adult mode on a chat turn. Order matters:
 * therapy and crossover scenes are never adult (P1-11), a companion who is
 * not a confirmed adult cannot be in adult mode, and no client flag can turn
 * adult on without a server-stored age attestation plus per-companion opt-in.
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
  /**
   * #763 R3, only set when ANIMA_SITUATIONAL_SCENES is on: true when the
   * scene is not strictly solo (computeAdultGated). Can only close the gate.
   */
  scene?: boolean;
  /**
   * Every companion in the turn is a confirmed adult (age >= 18 or
   * age_is_adult === true, and never a numeric age under 18). Missing age
   * defaults to not adult.
   */
  characterAdult?: boolean;
  /**
   * Per-companion opt-in (IntimacyProfile.intimacyEnabled) for the active
   * speaker. Required together with attestation and the global toggle.
   */
  companionOptIn?: boolean;
};

export type AdultGateReason =
  | "therapy"
  | "crossover"
  | "scene"
  | "character_age"
  | "not_attested"
  | "not_requested"
  | "companion_opt_in"
  | "allowed";

export function adultGate(i: AdultGateInput): { adult: boolean; reason: AdultGateReason } {
  if (i.therapy) return { adult: false, reason: "therapy" };
  if (i.crossover) return { adult: false, reason: "crossover" };
  if (i.scene === true) return { adult: false, reason: "scene" };
  if (i.characterAdult !== true) return { adult: false, reason: "character_age" };
  if (!i.settingEnabled && !i.requested) return { adult: false, reason: "not_requested" };
  if (!i.ageAttested) return { adult: false, reason: "not_attested" };
  if (i.companionOptIn !== true) return { adult: false, reason: "companion_opt_in" };
  return { adult: true, reason: "allowed" };
}
