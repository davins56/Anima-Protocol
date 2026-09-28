/**
 * Mood co-write for one chat turn.
 *
 * The companion's felt state is stored on `companion_memories.emotional_state`
 * under `selfState`, stamped with `moodTurnId`. A retry of the same turn sees
 * the stamp and does not evolve mood again.
 */

export const MOOD_TURN_ID_KEY = "moodTurnId";

export function moodTurnAlreadyWritten(
  emotionalState: Record<string, unknown> | null | undefined,
  turnId: string,
): boolean {
  if (!emotionalState || typeof emotionalState !== "object") return false;
  return emotionalState[MOOD_TURN_ID_KEY] === turnId;
}

/**
 * Merge this turn's mood into the existing emotional blob.
 * Returns the previous blob unchanged when this turn was already written.
 */
export function emotionalStateWithTurnMood(
  emotionalState: Record<string, unknown> | null | undefined,
  turnId: string,
  selfState: Record<string, unknown> | null | undefined,
): { state: Record<string, unknown>; wrote: boolean } {
  const base =
    emotionalState && typeof emotionalState === "object" ? { ...emotionalState } : {};
  if (!turnId || moodTurnAlreadyWritten(base, turnId)) {
    return { state: base, wrote: false };
  }
  if (!selfState || typeof selfState !== "object") {
    return { state: base, wrote: false };
  }
  return {
    state: {
      ...base,
      selfState,
      [MOOD_TURN_ID_KEY]: turnId,
    },
    wrote: true,
  };
}
