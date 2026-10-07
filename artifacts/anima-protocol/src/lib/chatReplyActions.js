// Plans for Retry and Edit/resend on a companion thread.
//
// Retry keeps his last user line and drops only her reply (and anything after
// it). Edit drops from his message onward, then the page sends the new wording
// once. Neither plan invents a second user turn for Retry, and both tell the
// send path to skip mood and memory (`replyAction`) so a replacement cannot
// double-count affect.

const PLACEHOLDER_NAMES = new Set(["__typing__", "__thinking__"]);

function listOf(messages) {
  return Array.isArray(messages) ? messages : [];
}

/** Turn id on a row, or the prefix of `turn_x:assistant:1`. */
export function messageTurnId(message) {
  if (!message || typeof message !== "object") return "";
  if (message.turn_id) return String(message.turn_id);
  if (message.late_turn_id) return String(message.late_turn_id);
  const metadata = message.metadata;
  if (metadata && typeof metadata === "object" && metadata.turn_id) {
    return String(metadata.turn_id);
  }
  const id = message.id ? String(message.id) : "";
  const marker = id.indexOf(":");
  return marker > 0 ? id.slice(0, marker) : "";
}

function isRetryDroppable(message) {
  if (!message || message.role === "user") return false;
  if (message.type === "crisis_resource" || message.type === "ai_notice") return false;
  if (isPlaceholder(message)) return true;
  return message.role === "assistant" || message.type === "event";
}

/**
 * Start of her reply. Bubbles that share this turn, and events sitting in
 * that run, are part of it. A previous assistant line with no turn id is a
 * different reply and stays.
 */
function replyRunStart(list, index) {
  const turnId = messageTurnId(list[index]);
  if (!turnId) return index;
  let start = index;
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (!isRetryDroppable(message)) break;
    const otherTurn = messageTurnId(message);
    if (otherTurn && otherTurn !== turnId) break;
    if (!otherTurn && message.role === "assistant" && message.type !== "event") break;
    start = i;
  }
  return start;
}

function discardedReplyIds(list, start) {
  const messageIds = [];
  let turnId = "";
  for (const message of list.slice(start)) {
    if (!message || message.role === "user") continue;
    if (message.id) messageIds.push(String(message.id));
    if (!turnId) {
      const id = messageTurnId(message);
      if (id) turnId = id;
    }
  }
  return { replacedTurnId: turnId, replacedMessageIds: messageIds };
}

function isPlaceholder(message) {
  if (!message || typeof message !== "object") return false;
  if (message.is_streaming === true) return true;
  return PLACEHOLDER_NAMES.has(message.character_name);
}

/**
 * True while she is answering, a follow-up is queued, or a reloaded unsent
 * draft is still waiting in the box. Retry and Edit must stay disabled.
 *
 * @param {{ answering?: boolean, turnLocked?: boolean, heldOutgoing?: boolean, restoredDraft?: boolean }} state
 */
export function replyActionsAreLocked(state) {
  if (!state) return false;
  return Boolean(state.answering || state.turnLocked || state.heldOutgoing || state.restoredDraft);
}

/**
 * @param {Array<Record<string, unknown>> | null | undefined} messages
 * @returns {{ lastUser: number, lastAssistant: number }}
 */
export function lastReplyActionIndexes(messages) {
  const list = listOf(messages);
  let lastUser = -1;
  let lastAssistant = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (!message || isPlaceholder(message)) continue;
    if (message.type === "event" || message.role === "system") continue;
    if (message.type === "crisis_resource" || message.type === "ai_notice") continue;
    if (lastAssistant < 0 && message.role === "assistant") lastAssistant = i;
    if (lastUser < 0 && message.role === "user") lastUser = i;
    if (lastAssistant >= 0 && lastUser >= 0) break;
  }
  return { lastUser, lastAssistant };
}

/**
 * Drop her reply at `index` and anything after it. His user line stays.
 * `index === messages.length` retries when her reply is already gone.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} messages
 * @param {number} index
 */
export function planRetryReply(messages, index) {
  const list = listOf(messages);
  if (index === list.length) {
    const lastUser = [...list].reverse().find((message) => message?.role === "user");
    const userContent = typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
    if (!userContent) return { ok: false, reason: "no_user" };
    return {
      ok: true,
      kept: list.slice(),
      userContent,
      discardedCount: 0,
      replacedTurnId: "",
      replacedMessageIds: [],
    };
  }
  const target = list[index];
  if (!target || target.role !== "assistant" || isPlaceholder(target)) {
    return { ok: false, reason: "not_assistant" };
  }
  const start = replyRunStart(list, index);
  const kept = list.slice(0, start);
  const lastUser = [...kept].reverse().find((message) => message?.role === "user");
  const userContent = typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
  return {
    ok: true,
    kept,
    userContent,
    discardedCount: list.length - start,
    ...discardedReplyIds(list, start),
  };
}

/**
 * Thread after a retry or edit has dropped the old reply. His line stays
 * unless its id is listed (edit rewrote it). Placeholders for that turn go too.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} messages
 * @param {{ turnId?: string, messageIds?: string[] }} [target]
 */
export function messagesAfterDiscardingReply(messages, target = {}) {
  const turnId = String(target.turnId || "");
  const messageIds = Array.isArray(target.messageIds) ? target.messageIds.map(String) : [];
  return listOf(messages).filter((message) => {
    if (!message) return false;
    const id = message.id ? String(message.id) : "";
    if (id && messageIds.includes(id)) return false;
    if (message.role === "user") return true;
    if (turnId && messageTurnId(message) === turnId) return false;
    return true;
  });
}

/**
 * Drop his message at `index` and anything after it. The caller sends `content`
 * once as the replacement user turn.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} messages
 * @param {number} index
 * @param {unknown} newText
 */
export function planEditResend(messages, index, newText) {
  const list = listOf(messages);
  const content = typeof newText === "string" ? newText.trim() : "";
  if (!content) return { ok: false, reason: "empty" };
  const target = list[index];
  if (!target || target.role !== "user") return { ok: false, reason: "not_user" };
  const discarded = list.slice(index);
  const replacedMessageIds = [];
  let replacedTurnId = "";
  for (const message of discarded) {
    if (!message) continue;
    if (message.id) replacedMessageIds.push(String(message.id));
    if (!replacedTurnId) {
      const id = messageTurnId(message);
      if (id) replacedTurnId = id;
    }
  }
  return {
    ok: true,
    kept: list.slice(0, index),
    content,
    discardedCount: list.length - index,
    replacedTurnId,
    replacedMessageIds,
  };
}
