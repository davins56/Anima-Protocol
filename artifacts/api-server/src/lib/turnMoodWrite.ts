/**
 * Mood co-write for one chat turn.
 *
 * The companion's felt state is stored on `companion_memories.emotional_state`
 * under `selfState`, stamped with `moodTurnId`. A retry of the same turn sees
 * the stamp and does not evolve mood again.
 */

export const MOOD_TURN_ID_KEY = "moodTurnId";
/** Bond strength for this turn was persisted. A retry must not add it again. */
export const RELATIONSHIP_TURN_ID_KEY = "relationshipTurnId";
/** Saved-moment pass for this turn already ran, whether or not one crystallized. */
export const SAVED_MOMENTS_TURN_ID_KEY = "savedMomentsTurnId";

function turnStampMatches(
  emotionalState: Record<string, unknown> | null | undefined,
  key: string,
  turnId: string,
): boolean {
  if (!emotionalState || typeof emotionalState !== "object" || !turnId) return false;
  return emotionalState[key] === turnId;
}

export function moodTurnAlreadyWritten(
  emotionalState: Record<string, unknown> | null | undefined,
  turnId: string,
): boolean {
  return turnStampMatches(emotionalState, MOOD_TURN_ID_KEY, turnId);
}

export function relationshipTurnAlreadyWritten(
  emotionalState: Record<string, unknown> | null | undefined,
  turnId: string,
): boolean {
  return turnStampMatches(emotionalState, RELATIONSHIP_TURN_ID_KEY, turnId);
}

export function savedMomentsTurnAlreadyWritten(
  emotionalState: Record<string, unknown> | null | undefined,
  turnId: string,
): boolean {
  return turnStampMatches(emotionalState, SAVED_MOMENTS_TURN_ID_KEY, turnId);
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

/**
 * Apply relationship strength and the saved-moment stamp without rewriting a
 * mood this turn already stored. Each part stamps the turn id, so a retry or
 * join of the same turn leaves all three untouched.
 */
export function emotionalStateWithTurnBond(
  emotionalState: Record<string, unknown> | null | undefined,
  turnId: string,
  input: {
    synchro?: Record<string, unknown> | null;
    selfState?: Record<string, unknown> | null;
    /** True once this turn's saved-moment pass has run. */
    saveMoment?: boolean;
  },
): {
  state: Record<string, unknown>;
  wroteMood: boolean;
  wroteRelationship: boolean;
  wroteSavedMoments: boolean;
} {
  const base =
    emotionalState && typeof emotionalState === "object" ? { ...emotionalState } : {};
  if (!turnId) {
    return {
      state: base,
      wroteMood: false,
      wroteRelationship: false,
      wroteSavedMoments: false,
    };
  }

  let state = base;
  let wroteMood = false;
  if (input.selfState && typeof input.selfState === "object") {
    const mood = emotionalStateWithTurnMood(state, turnId, input.selfState);
    state = mood.state;
    wroteMood = mood.wrote;
  }

  let wroteRelationship = false;
  if (
    input.synchro &&
    typeof input.synchro === "object" &&
    !relationshipTurnAlreadyWritten(state, turnId)
  ) {
    const synchro = { ...input.synchro };
    delete synchro.selfState;
    delete synchro[MOOD_TURN_ID_KEY];
    delete synchro[RELATIONSHIP_TURN_ID_KEY];
    delete synchro[SAVED_MOMENTS_TURN_ID_KEY];
    state = {
      ...state,
      ...synchro,
      [RELATIONSHIP_TURN_ID_KEY]: turnId,
    };
    wroteRelationship = true;
  }

  let wroteSavedMoments = false;
  if (input.saveMoment && !savedMomentsTurnAlreadyWritten(state, turnId)) {
    state = {
      ...state,
      [SAVED_MOMENTS_TURN_ID_KEY]: turnId,
    };
    wroteSavedMoments = true;
  }

  return { state, wroteMood, wroteRelationship, wroteSavedMoments };
}
