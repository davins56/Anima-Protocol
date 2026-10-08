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

const MESSAGE_ROLE_SUFFIX = /:(?:user|assistant|event)(?::\d+)?$/;

/** Turn id on a row, or the id with a `:user` / `:assistant` / `:event` suffix removed. */
export function messageTurnId(message) {
  if (!message || typeof message !== "object") return "";
  if (message.turn_id) return String(message.turn_id);
  if (message.late_turn_id) return String(message.late_turn_id);
  const metadata = message.metadata;
  if (metadata && typeof metadata === "object" && metadata.turn_id) {
    return String(metadata.turn_id);
  }
  const id = message.id ? String(message.id) : "";
  const suffix = MESSAGE_ROLE_SUFFIX.exec(id);
  return suffix && suffix.index > 0 ? id.slice(0, suffix.index) : "";
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

function messageSeq(message) {
  const seq = message?.seq;
  if (typeof seq === "number" && Number.isFinite(seq)) return seq;
  if (typeof seq === "string" && seq.trim() !== "" && Number.isFinite(Number(seq))) {
    return Number(seq);
  }
  return null;
}

/** Ids, turn ids, and sequence of the suffix a retry or edit is dropping. */
export function suffixReplacement(list, start) {
  const messageIds = [];
  const turnIds = [];
  let fromMessageId = "";
  let fromSeq = null;
  const targetTurn = messageTurnId(list[start]);
  for (const message of list.slice(start)) {
    if (fromSeq == null) {
      const seq = messageSeq(message);
      if (seq != null) fromSeq = seq;
    }
    const turn = messageTurnId(message);
    if (turn && !turnIds.includes(turn)) turnIds.push(turn);
    if (!message?.id) continue;
    const id = String(message.id);
    messageIds.push(id);
    if (!fromMessageId) fromMessageId = id;
  }
  return {
    replacedTurnId: targetTurn,
    replacedTurnIds: turnIds,
    replacedFromSeq: fromSeq,
    replacedFromMessageId: fromMessageId,
    replacedMessageIds: messageIds,
  };
}

function claimDiscardedId(set, counts, kind, id) {
  const value = String(id || "");
  if (!value) return;
  set.add(value);
  if (!counts) return;
  const key = `${kind}:${value}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}

function releaseClaimedId(set, counts, kind, id) {
  const value = String(id || "");
  if (!value) return;
  if (counts) {
    const key = `${kind}:${value}`;
    const next = (counts.get(key) || 0) - 1;
    if (next > 0) {
      counts.set(key, next);
      return;
    }
    counts.delete(key);
  }
  set.delete(value);
}

/**
 * Hide a reply the user is replacing, including every later turn in the suffix.
 * `counts` keeps an id hidden until every owner has released it.
 *
 * @param {Set<string>} turnIds
 * @param {Set<string>} messageIds
 * @param {{ turnId?: string, turnIds?: string[], messageIds?: string[] }} [target]
 * @param {Map<string, number>} [counts]
 */
export function rememberDiscardedIds(turnIds, messageIds, target = {}, counts) {
  if (target.turnId) claimDiscardedId(turnIds, counts, "turn", target.turnId);
  for (const id of target.turnIds || []) claimDiscardedId(turnIds, counts, "turn", id);
  for (const id of target.messageIds || []) claimDiscardedId(messageIds, counts, "message", id);
}

/**
 * Put those ids back when the replacement never starts, so the restored
 * reply is visible again. Suffix ids have to be released too. An id another
 * retry still owns stays hidden.
 *
 * @param {Set<string>} turnIds
 * @param {Set<string>} messageIds
 * @param {{ turnId?: string, turnIds?: string[], messageIds?: string[] }} [target]
 * @param {Map<string, number>} [counts]
 */
export function releaseDiscardedIds(turnIds, messageIds, target = {}, counts) {
  if (target.turnId) releaseClaimedId(turnIds, counts, "turn", target.turnId);
  for (const id of target.turnIds || []) releaseClaimedId(turnIds, counts, "turn", id);
  for (const id of target.messageIds || []) releaseClaimedId(messageIds, counts, "message", id);
}

/**
 * Thread a hung retry keeps. The suffix starts at `start`, so later turns
 * are not already "kept" when new arrivals are merged back in.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} source
 * @param {number} start
 * @param {{ turnId?: string, messageIds?: string[] }} [target]
 */
export function threadForHungRetry(source, start, target = {}) {
  const list = listOf(source);
  if (start >= 0) return list.slice(0, start);
  return messagesAfterDiscardingReply(list, target);
}

/**
 * Messages that landed after the trim was planned. They stay unless they
 * belong to the suffix being replaced. The same array comes back when
 * nothing new arrived.
 */
export function keepArrivals(kept, latest, discarded) {
  const base = listOf(kept);
  const keptIds = new Set(
    base.map((message) => (message?.id ? String(message.id) : "")).filter(Boolean),
  );
  const dropIds = new Set((discarded?.messageIds || []).map(String));
  const dropTurns = new Set((discarded?.turnIds || []).map(String).filter(Boolean));
  const extra = [];
  for (const message of listOf(latest)) {
    const id = message?.id ? String(message.id) : "";
    if (id && (keptIds.has(id) || dropIds.has(id))) continue;
    const turn = messageTurnId(message);
    if (turn && dropTurns.has(turn)) continue;
    extra.push(message);
  }
  if (extra.length === 0) return base;
  return [...base, ...extra];
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
      replacedTurnIds: [],
      replacedFromSeq: null,
      replacedFromMessageId: "",
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
    ...suffixReplacement(list, start),
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
  const suffix = suffixReplacement(list, index);
  return {
    ok: true,
    kept: list.slice(0, index),
    content,
    discardedCount: list.length - index,
    ...suffix,
    replacedTurnId: messageTurnId(target),
  };
}
