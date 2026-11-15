/**
 * Shapes of the agreed /api/martial-arts contract (#768 §6). The server
 * (Backend Data) owns these routes; the client renders server data only.
 */
import type { Axis, MartialProfile, StylePick, Tone } from "@workspace/martial-core";

export type MartialStatus = { enabled: boolean; library_version: string };

export type RankedPick = StylePick & { score: number };

export type CharacterStyleView = {
  profile: MartialProfile | null;
  suggestion: { primary: StylePick; secondary: StylePick | null; reason_axes: Axis[]; explanation: string } | null;
  ranking: RankedPick[];
  stale: boolean;
  library_version: string;
};

export type PickAction = "auto" | "reroll" | "override";

export type PickBody = {
  action: PickAction;
  primary?: { style_id: string; variant_id?: string | null };
  secondary?: { style_id: string; variant_id?: string | null } | null;
  expected_rev: number;
};

/** `session.config.style` frozen by the server at sim session creation (§3). */
export type SessionStyle = {
  styleId: string;
  variantId: string | null;
  secondaryId: string | null;
  tone: Tone;
};
