import type { ChipId } from "@workspace/sim-core";

/** The ten selection axes (§4). Style weights are 0–3 per axis. */
export const AXES = [
  "aggression",
  "patience",
  "precision",
  "flow",
  "control",
  "cunning",
  "grit",
  "tradition",
  "pragmatism",
  "rhythm",
] as const;
export type Axis = (typeof AXES)[number];
export type AxisVector = Record<Axis, number>;

export type StyleSource = "seed" | "user";
export type StyleKind = "striking" | "grappling" | "hybrid" | "weapon";
export type StyleRange = "close" | "mid" | "long" | "clinch" | "ground" | "weapon";

export type MartialVariant = {
  id: string;
  source: StyleSource;
  name: string;
  description: string;
  /** small axis tilt added to the style's weights */
  tilt: Partial<AxisVector>;
};

export type MartialStyle = {
  id: string;
  source: StyleSource;
  name: string;
  family: string;
  kind: StyleKind;
  range: StyleRange;
  /** short factual description, ≤ 160 chars, plain text */
  summary: string;
  axes: AxisVector;
  variants: MartialVariant[];
  /** where the summary can be checked (seed styles); user styles may leave this empty */
  sources: string[];
};

export type StylePick = { style_id: string; variant_id: string | null };

/** Battle tone, computed on the server from the public affect layer only (§5, K3). */
export const TONES = ["composed", "fierce", "guarded", "shaken", "playful"] as const;
export type Tone = (typeof TONES)[number];

/**
 * Battle effects. strike/weapon/guard are multipliers in [0.85, 1.15];
 * guard multiplies INCOMING damage (below 1 = she takes less). control is
 * 0–3 ticks of enemy delay. speed is NetBattle-only (no 4D tempo knob).
 */
export type BattleMods = {
  strike: number;
  weapon: number;
  guard: number;
  control: number;
  speed: number;
  weaponChips: ChipId[];
};

export type ProfileSource = "auto" | "reroll" | "override";

/** Stored on the anima's own row as `data.martial_arts` (server-owned, §3). */
export type MartialProfile = {
  version: 1;
  library_version: string;
  rev: number;
  primary: StylePick;
  secondary: StylePick | null;
  source: ProfileSource;
  roll: number;
  reason_axes: Axis[];
  explanation: string;
  inputs_hash: string;
  chosen_at: string;
};

/** Personality inputs: this character's own fields only (§4). */
export type PersonalityInputs = {
  personality?: unknown;
  speaking_style?: unknown;
  backstory?: unknown;
  tagline?: unknown;
  traits?: unknown;
  archetype?: unknown;
  expression_spectrum?: unknown;
  /** static personality baseline family (affectBaselineFromPersonality), never live mood */
  baseline_family?: unknown;
};
