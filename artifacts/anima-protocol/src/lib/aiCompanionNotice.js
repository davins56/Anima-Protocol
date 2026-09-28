/**
 * AI companion disclosures for the chat screen.
 *
 * The notice is a system row, not a character message. It is tracked per
 * conversation and must be stripped before any transcript is sent to a model.
 */

export const AI_COMPANION_NOTICE_TEXT =
  "You're chatting with an AI companion, not a human.";

export const AI_COMPANION_HEADER_LINE = "Companions are AI.";

export const CRISIS_RESOURCE_CARD_TEXT =
  "If you're thinking about suicide or self-harm, you can call or text 988 (US, Suicide & Crisis Lifeline) or text HOME to 741741. If you're outside the US, contact local emergency services.";

/** New York GBL Art. 47 and California SB 243: repeat at least every three hours. */
export const AI_NOTICE_REPEAT_MS = 3 * 60 * 60 * 1000;

const STORAGE_PREFIX = "anima:ai-companion-notice:";

export function aiNoticeStorageKey(sessionId) {
  return `${STORAGE_PREFIX}${sessionId || ""}`;
}

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode */
  }
  return null;
}

export function parseNoticeTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readAiNoticeShownAt(sessionId, storage) {
  const store = storageOrNull(storage);
  if (!sessionId || !store) return null;
  try {
    return parseNoticeTimestamp(store.getItem(aiNoticeStorageKey(sessionId)));
  } catch {
    return null;
  }
}

export function writeAiNoticeShownAt(sessionId, timestamp, storage) {
  const store = storageOrNull(storage);
  if (!sessionId || !store) return;
  try {
    store.setItem(aiNoticeStorageKey(sessionId), String(timestamp));
  } catch {
    /* quota or private mode */
  }
}

export function latestNoticeShownAt(lastShownAt, serverShownAt) {
  const stamps = [lastShownAt, serverShownAt].filter((value) => Number.isFinite(value));
  if (!stamps.length) return null;
  return Math.max(...stamps);
}

/**
 * Show at the start of a conversation (no timestamp yet) and again once
 * three hours have passed since the later of the local and server stamps.
 * Solo and group sessions share this rule.
 */
export function shouldShowAiCompanionNotice({
  lastShownAt = null,
  serverShownAt = null,
  now = Date.now(),
} = {}) {
  const latest = latestNoticeShownAt(
    parseNoticeTimestamp(lastShownAt),
    parseNoticeTimestamp(serverShownAt),
  );
  if (latest == null) return true;
  return now - latest >= AI_NOTICE_REPEAT_MS;
}

export function isAiCompanionNoticeMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.type === "ai_notice" || message.kind === "ai_notice") return true;
  if (message.role === "system" && String(message.content || "").trim() === AI_COMPANION_NOTICE_TEXT) {
    return true;
  }
  return false;
}

export function isCrisisResourceMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.type === "crisis_resource" || message.kind === "crisis_resource") return true;
  const text = String(message.content || "").trim();
  return message.role !== "user" && text === CRISIS_RESOURCE_CARD_TEXT;
}

/** Drop system notices and crisis cards before a transcript is sent to a model. */
export function messagesForModel(messages) {
  return (Array.isArray(messages) ? messages : []).filter(
    (message) => !isAiCompanionNoticeMessage(message) && !isCrisisResourceMessage(message) && message?.role !== "system",
  );
}

/** The history block Chat places in the client prompt. */
export function chatHistoryForLlm(messages, limit = 14) {
  return messagesForModel(messages)
    .slice(-limit)
    .map((message) => {
      const speaker = message.role === "user" ? "You" : (message.character_name || "Character");
      const text = String(message.content || "");
      const clipped = text.length > 800 ? `${text.slice(0, 799)}…` : text;
      return `${speaker}: ${clipped}`;
    })
    .join("\n");
}

export function crisisCardFromPayload(payload) {
  const card = payload?.crisis_resource || payload?.crisisResource || null;
  const content = String(card?.content || "").trim();
  if (!content) return null;
  return {
    role: "system",
    type: "crisis_resource",
    content,
    timestamp: new Date().toISOString(),
  };
}
