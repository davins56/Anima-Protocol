/**
 * Reply ratings (client). Builds the POST /api/ratings payload for one
 * assistant reply: the reply, an optional better version (thumbs down only),
 * and up to 12 prior turns so the server can export chosen/rejected pairs.
 */
export const RATING_CONTEXT_TURNS = 12;

function isChatTurn(m) {
  return m && (m.role === "user" || m.role === "assistant") && !m.type && m.character_name !== "__typing__" && m.character_name !== "__thinking__";
}

export function messageRatingId(message, sessionId, index) {
  return String(message?.id || (message?.turn_id ? `${message.turn_id}:assistant` : `${sessionId}:${index}`));
}

export function buildRatingPayload({ session, messages, index, rating, betterReply }) {
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
  return {
    session_id: String(session?.id || ""),
    message_id: messageRatingId(message, session?.id, index),
    turn_id: message.turn_id || null,
    character_id: message.character_id || null,
    character_name: message.character_name || null,
    rating,
    reply,
    ...(better && better !== reply ? { better_reply: better } : {}),
    context,
  };
}
