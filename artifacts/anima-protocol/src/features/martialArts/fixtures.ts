/**
 * Fixtures for the agreed /api/martial-arts contract (#768 §6). They are built
 * with martial-core itself, so they match what the server computes.
 */
import { autoProfile, chooseStyle, explain, SEED_LIBRARY } from "@workspace/martial-core";
import type { CharacterStyleView } from "./types";

const inputs = { personality: "Disciplined, precise and focused. Quiet and patient.", speaking_style: "terse" };
const choice = chooseStyle({ inputs, characterId: "char-a", lib: SEED_LIBRARY });

export const PROFILE = autoProfile({ lib: SEED_LIBRARY, inputs, characterId: "char-a", rev: 1, now: "2026-11-15T17:00:00.000Z" });

export const VIEW_NO_PROFILE: CharacterStyleView = {
  profile: null,
  suggestion: {
    primary: choice.primary,
    secondary: choice.secondary,
    reason_axes: choice.reason_axes,
    explanation: explain({ lib: SEED_LIBRARY, primary: choice.primary, secondary: choice.secondary, reasonAxes: choice.reason_axes, speakingStyle: "terse" }),
  },
  ranking: choice.ranking,
  stale: false,
  library_version: SEED_LIBRARY.version,
};

export const VIEW_WITH_PROFILE: CharacterStyleView = { ...VIEW_NO_PROFILE, profile: PROFILE };

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
