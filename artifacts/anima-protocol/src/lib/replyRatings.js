/**
 * Reply ratings (client). Builds the POST /api/ratings payload for one
 * assistant reply: the reply, an optional better version (thumbs down only),
 * and up to 12 prior turns so the server can export chosen/rejected pairs.
 */
export const RATING_CONTEXT_TURNS = 12;

function isChatTurn(m) {
  return m && (m.role === "user" || m.role === "assistant") && !m.type && m.character_name !== "__typing__" && m.character_name !== "__thinking__";
}

/**
 * Companion id for a reply. Chat rows usually carry only character_name, but
 * the server reads corrections back by character_id (the id chat.ts sends as
 * assistant_character_id), so a null id means the lesson is never used.
 */
export function resolveRatingCharacterId(message, session, characters) {
  if (message?.character_id) return String(message.character_id);
  const name = String(message?.character_name || "").trim().toLowerCase();
  const list = Array.isArray(characters) ? characters : [];
  if (name) {
    const groupIds = Array.isArray(session?.group_character_ids) ? session.group_character_ids : [];
    const named = list.filter((c) => c?.id && String(c.name || "").trim().toLowerCase() === name);
    const match = named.find((c) => groupIds.includes(c.id) || c.id === session?.character_id) || named[0];
    if (match) return String(match.id);
  }
  return session?.character_id ? String(session.character_id) : null;
}

export function buildRatingPayload({ session, messages, characters, index, rating, betterReply, note }) {
  const list = Array.isArray(messages) ? messages : [];
  const message = list[index];
  if (!message || message.role !== "assistant") return null;
  const reply = String(message.content || "").trim();
  if (!reply) return null;
  const context = list
    .slice(0, index)
    .filter(isChatTurn)
    .slice(-RATING_CONTEXT_TURNS)
    .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 2000) }));
  const better = rating === -1 ? String(betterReply || "").trim() : "";
  const why = rating === -1 ? String(note || "").trim().slice(0, 600) : "";
  return {
    session_id: String(session?.id || ""),
    message_id: messageRatingId(message, session?.id, index),
    turn_id: message.turn_id || null,
    character_id: resolveRatingCharacterId(message, session, characters),
    character_name: message.character_name || null,
    rating,
    reply,
    ...(better && better !== reply ? { better_reply: better } : {}),
    ...(why ? { note: why } : {}),
    context,
  };
}
