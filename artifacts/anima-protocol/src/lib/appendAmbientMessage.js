/**
 * Append one ambient/background chat message without rewriting history.
 *
 * ChatSession.update({ messages }) goes through replaceMessages, which deletes
 * any stored row whose id is not in the supplied array. Background jobs that
 * capture a stale `finalMessages` snapshot (Serenity ambient, group
 * interaction, side-quest accept) must NEVER use that path — concurrent turns
 * would silently wipe newer messages.
 *
 * Prefer this helper (or base44.messages.append) for additive ambient bubbles.
 */

export async function appendAmbientMessage({
  appendMessage,
  sessionId,
  message,
  setActiveSession,
}) {
  if (!sessionId) {
    throw new Error("appendAmbientMessage requires sessionId");
  }
  if (typeof appendMessage !== "function") {
    throw new Error("appendAmbientMessage requires appendMessage");
  }
  const stored = await appendMessage(sessionId, message);
  if (typeof setActiveSession === "function") {
    setActiveSession((prev) => {
      if (!prev || prev.id !== sessionId) return prev;
      return {
        ...prev,
        messages: [...(prev.messages || []), stored],
      };
    });
  }
  return stored;
}
