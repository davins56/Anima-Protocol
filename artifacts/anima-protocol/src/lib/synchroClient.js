import { animaApi } from "@/api/animaApi";

/** Long-term resonance for a companion, or null when it cannot be read. */
export async function fetchSynchro(characterId) {
  if (!characterId) return null;
  try {
    const data = await animaApi.relationshipOs.synchro(characterId);
    return data?.synchro ?? null;
  } catch (err) {
    console.error("fetchSynchro error:", err);
    return null;
  }
}

/** One id per Sacred Space attempt; reused on retry so the server awards it once. */
export function newSacredSessionId(prefix = "sacred") {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

/**
 * Report a completed Sacred Space activity. Returns the server's resonance
 * result ({ awarded, duplicate, capped, strength, level, label, tierChanged })
 * or null; failure never blocks the ritual itself.
 */
export async function completeSacredSpace({
  characterId,
  sessionId,
  activity,
  userTurns,
  stepsCompleted,
  hasReflection,
}) {
  if (!characterId || !sessionId) return null;
  try {
    const data = await animaApi.relationshipOs.completeSacredSpace({
      character_id: characterId,
      session_id: sessionId,
      activity,
      user_turns: userTurns,
      steps_completed: stepsCompleted,
      has_reflection: Boolean(hasReflection),
    });
    return data?.resonance ?? null;
  } catch (err) {
    console.error("completeSacredSpace error:", err);
    return null;
  }
}
