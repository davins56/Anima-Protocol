/**
 * Resting mode (client). When the server reports `resting: true` (the local
 * model / tunnel is down), the reply failure is shown as an in-character
 * "she's resting" notice instead of an error toast. The user's message stays
 * in the chat; the server queued it and the reply arrives later as a normal
 * assistant message (proactive cron / app-open warm).
 */
export function isRestingError(err) {
  return Boolean(err && typeof err === "object" && err.resting === true);
}

export function restingCopy(name, queued = true) {
  const who = String(name || "").trim() || "She";
  return queued
    ? `${who} is resting right now. Your message is safe with her — she'll answer as soon as she wakes.`
    : `${who} is resting right now. Try again in a little while.`;
}

/** Chat row for the notice. role:"system" keeps it out of the model transcript. */
export function restingNotice({ name, turnId, queued = true, message } = {}) {
  return {
    role: "system",
    type: "resting_notice",
    content: String(message || "").trim() || restingCopy(name, queued),
    resting_queued: queued !== false,
    ...(turnId ? { turn_id: turnId } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function withRestingNotice(messages, notice) {
  const list = Array.isArray(messages) ? messages : [];
  const rest = list.filter((m) => !(m?.type === "resting_notice" && notice?.turn_id && m.turn_id === notice.turn_id));
  return [...rest, notice];
}
