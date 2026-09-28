/**
 * Location flavor is optional. Companion chat must not wait on it.
 *
 * The return value is undefined, not a Promise. Awaiting the scheduler
 * resolves on the next microtask and does not observe the in-flight invoke.
 * The invoke still runs every fifth message (same cadence as before) and
 * only when a solo character is in the turn.
 */
export function scheduleLocationContextInject(
  invoke,
  { messageCount, sessionId, character } = {},
) {
  if (!character || messageCount % 5 !== 0) return;
  const payload = {
    session_id: sessionId,
    character_id: character.id,
    character_name: character.name,
  };
  try {
    const pending = invoke("injectLocationContext", payload);
    if (pending && typeof pending.catch === "function") {
      pending.catch((err) => {
        console.error("Location context injection error:", err);
      });
    }
  } catch (err) {
    console.error("Location context injection error:", err);
  }
}
