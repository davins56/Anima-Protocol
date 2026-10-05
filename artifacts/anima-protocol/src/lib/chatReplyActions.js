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
    return { ok: true, kept: list.slice(), userContent, discardedCount: 0 };
  }
  const target = list[index];
  if (!target || target.role !== "assistant" || isPlaceholder(target)) {
    return { ok: false, reason: "not_assistant" };
  }
  const kept = list.slice(0, index);
  const lastUser = [...kept].reverse().find((message) => message?.role === "user");
  const userContent = typeof lastUser?.content === "string" ? lastUser.content.trim() : "";
  return {
    ok: true,
    kept,
    userContent,
    discardedCount: list.length - index,
  };
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
  return {
    ok: true,
    kept: list.slice(0, index),
    content,
    discardedCount: list.length - index,
  };
}
