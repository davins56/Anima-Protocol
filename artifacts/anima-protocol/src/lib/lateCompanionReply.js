/**
 * A slow self-hosted reply can still land after this request fails.
 * A browser deadline (the fetch abort) shows Retry immediately and only
 * checks the saved turn in the background. A dropped connection or a turn
 * that is still generating keeps the typing indicator until the ledger
 * answers, and must not toast the generic failure while that check runs.
 */

export const GENERIC_COMPANION_COULD_NOT_REPLY =
  "The companion could not reply. Please try again.";

/** Shown while a dropped connection is checked against the durable turn. */
export const CONNECTION_DROPPED_STATUS =
  "Connection dropped, checking for her reply…";

const ENGINE_TYPE_ERROR_RE =
  /before initialization|is not defined|is not a function|Cannot read propert|dynamically imported module/i;
const NETWORK_DROP_RE =
  /failed to fetch|load failed|networkerror|network request failed|network connection|internet connection/i;

const TOOK_TOO_LONG_RE = /took too long/i;

/**
 * @param {unknown} err
 * @returns {boolean}
 */
/**
 * A fetch TypeError from a backgrounded or suspended tab. Engine TypeErrors
 * (missing bindings, TDZ) stay ordinary failures.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
/**
 * The durable turn finished without a reply. Polling should stop and the
 * checking bubble should come down.
 *
 * @param {unknown} turn
 * @returns {boolean}
 */
export function lateTurnFailedWithoutReply(turn) {
  if (!turn || typeof turn !== "object") return false;
  const row = /** @type {{ assistant_content?: unknown, assistantContent?: unknown, persistence_status?: unknown, status?: unknown }} */ (
    turn
  );
  if (String(row.assistant_content || row.assistantContent || "").trim()) return false;
  const status = row.persistence_status || row.status;
  return status === "failed";
}

export function isConnectionDroppedError(err) {
  if (!err || typeof err !== "object") return false;
  const error = /** @type {{ name?: unknown, message?: unknown }} */ (err);
  const message = String(error.message || "");
  if (ENGINE_TYPE_ERROR_RE.test(message)) return false;
  const name = typeof error.name === "string" ? error.name : "";
  if (name === "NetworkError") return true;
  if (name === "TypeError" && NETWORK_DROP_RE.test(message)) return true;
  return false;
}

export function isCompanionStillTypingError(err) {
  if (!err || typeof err !== "object") return false;
  const error = /** @type {{ code?: unknown, name?: unknown, status?: unknown, message?: unknown }} */ (
    err
  );
  const code = typeof error.code === "string" ? error.code : "";
  const name = typeof error.name === "string" ? error.name : "";
  if (
    code === "chat_stream_timeout" ||
    code === "turn_in_flight" ||
    code === "companion_still_typing" ||
    code === "ABORT_ERR"
  ) {
    return true;
  }
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (error.status === 409 && (code === "turn_in_flight" || code === "")) {
    const message = String(error.message || "");
    if (code === "turn_in_flight" || /already being processed/i.test(message)) {
      return true;
    }
  }
  const message = String(error.message || "");
  if (TOOK_TOO_LONG_RE.test(message)) return true;
  if (message === GENERIC_COMPANION_COULD_NOT_REPLY) return true;
  return false;
}

/**
 * The browser already spent `CHAT_FETCH_ABORT_MS` on this send. Another full
 * generation poll would keep the typing bubble up for minutes after Retry
 * should be on screen. An in-flight turn or a dropped socket is not this:
 * the server may still be writing the reply.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isBrowserChatDeadlineError(err) {
  if (!err || typeof err !== "object") return false;
  const error = /** @type {{ code?: unknown, name?: unknown, message?: unknown }} */ (err);
  const code = typeof error.code === "string" ? error.code : "";
  const name = typeof error.name === "string" ? error.name : "";
  if (code === "chat_stream_timeout" || code === "ABORT_ERR") return true;
  if (name === "AbortError" || name === "TimeoutError") return true;
  return TOOK_TOO_LONG_RE.test(String(error.message || ""));
}

/**
 * @param {Record<string, unknown>} message
 * @param {string} turnId
 * @param {string} userId
 * @param {string} assistantId
 */
function messageBelongsToTurn(message, turnId, userId, assistantId) {
  if (message.id === userId || message.id === assistantId) return true;
  return message.turn_id === turnId;
}

/**
 * Remove only the typing/thinking bubble for this turn.
 * Other in-flight placeholders in the session stay.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} messages
 * @param {unknown} turnId
 */
export function dropTurnPlaceholder(messages, turnId) {
  const id = String(turnId || "");
  if (!id) return messages || [];
  return (messages || []).filter((message) => {
    if (!message) return true;
    const placeholder =
      message.character_name === "__typing__" || message.character_name === "__thinking__";
    if (placeholder && message.turn_id === id) return false;
    return true;
  });
}

/** Flags Retry uses to replace a reply the model did not finish. */
export function cutOffReplyFields(source) {
  if (!source || typeof source !== "object") return {};
  if (source.reply_interrupted === true || source.cut_off === true) {
    return { reply_interrupted: true, cut_off: true };
  }
  return {};
}

export function mergeLateReplyIntoMessages(messages, turn) {
  const turnId = String(turn.turnId || "");
  const userId = `${turnId}:user`;
  const assistantId = `${turnId}:assistant`;
  const source = (messages || []).filter((message) => {
    if (!message) return false;
    const placeholder =
      message.character_name === "__typing__" || message.character_name === "__thinking__";
    if (!placeholder) return true;
    // Another send may already be typing. Only this turn's bubble comes down.
    if (message.turn_id === turnId || message.late_turn_id === turnId) return false;
    if (!message.turn_id && !message.late_turn_id) return false;
    return true;
  });
  /** @type {Record<string, unknown>[]} */
  const kept = [];
  let insertAt = null;
  for (const message of source) {
    if (messageBelongsToTurn(message, turnId, userId, assistantId)) {
      if (insertAt == null) insertAt = kept.length;
      continue;
    }
    kept.push(message);
  }
  if (insertAt == null) {
    const turnTime = Date.parse(String(turn.createdAt || turn.timestamp || ""));
    if (Number.isFinite(turnTime)) {
      const newerAt = kept.findIndex((message) => {
        const at = Date.parse(
          String(message.timestamp || message.created_date || ""),
        );
        return Number.isFinite(at) && at > turnTime;
      });
      insertAt = newerAt >= 0 ? newerAt : kept.length;
    } else {
      insertAt = kept.length;
    }
  }
  /** @type {Record<string, unknown>[]} */
  const block = [];
  const userContent = String(turn.userContent || "");
  if (userContent.trim()) {
    block.push({
      id: userId,
      turn_id: turnId,
      role: "user",
      content: userContent,
      timestamp: turn.createdAt || turn.timestamp || new Date().toISOString(),
    });
  }
  const assistantContent = String(turn.assistantContent || "");
  if (assistantContent.trim()) {
    block.push({
      id: assistantId,
      turn_id: turnId,
      role: "assistant",
      content: assistantContent,
      character_name: turn.characterName || "Character",
      timestamp: turn.createdAt || new Date().toISOString(),
      ...cutOffReplyFields(turn),
    });
  }
  kept.splice(insertAt, 0, ...block);
  return kept;
}

/**
 * How long a still-running turn is polled before the typing bubble comes
 * down. Used when this browser has not already spent the fetch abort
 * (connection drop, joined in-flight turn, reopened pending turn).
 * Covers the local slot queue (`LLM_LOCAL_SLOT_WAIT_MS`, 180s) plus the
 * generation cap (`LLM_LOCAL_FIRST_TOKEN_MS` 90s + `LLM_LOCAL_DECODE_SLACK_MS` 30s).
 */
export const LATE_REPLY_POLL_MS = 300_000;

/**
 * After the browser abort, how long a background check may still adopt a
 * saved reply. This does not block the error toast or Retry.
 * Kept inside a minute so a late persist can land without another 5 minutes
 * of "..." after the fetch already waited `CHAT_FETCH_ABORT_MS`.
 */
export const LATE_REPLY_AFTER_ABORT_MS = 45_000;

/**
 * @param {unknown} err
 * @returns {{ showRetryImmediately: boolean, backgroundMs: number, blockingMs: number }}
 */
export function lateReplyRecoveryPlan(err) {
  if (isBrowserChatDeadlineError(err)) {
    return {
      showRetryImmediately: true,
      backgroundMs: LATE_REPLY_AFTER_ABORT_MS,
      blockingMs: 0,
    };
  }
  return {
    showRetryImmediately: false,
    backgroundMs: 0,
    blockingMs: LATE_REPLY_POLL_MS,
  };
}

/**
 * A background watch for one timed-out turn. A retry, an edit, or the same
 * line sent again marks it superseded so the saved reply cannot stack on
 * the new attempt.
 *
 * @param {{ turnId?: unknown, sessionId?: unknown, userContent?: unknown }} turn
 */
export function createLateReplyWatch(turn) {
  return {
    turnId: String(turn?.turnId || ""),
    sessionId: String(turn?.sessionId || ""),
    userContent: String(turn?.userContent || ""),
    superseded: false,
  };
}

/**
 * @param {{ sessionId?: string, userContent?: string, superseded?: boolean } | null | undefined} watch
 * @param {{ sessionId?: unknown, content?: unknown, replyAction?: unknown }} send
 * @returns {boolean}
 */
export function lateReplyWatchSupersededBy(watch, send) {
  if (!watch || watch.superseded) return false;
  const sessionId = String(send?.sessionId || "");
  if (watch.sessionId && sessionId && watch.sessionId !== sessionId) return false;
  const action = send?.replyAction;
  if (action === "retry" || action === "edit") return true;
  return String(send?.content ?? "").trim() === String(watch.userContent ?? "").trim();
}

/**
 * Put a saved reply on the thread once. A superseded watch (retry or edit
 * already started, or the same line was sent again) leaves the thread alone
 * so the two arrivals cannot duplicate.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} messages
 * @param {Record<string, unknown>} turn
 * @param {{ superseded?: boolean }} [options]
 * @returns {{ messages: Array<Record<string, unknown>>, painted: boolean }}
 */
export function paintLateCompanionReply(messages, turn, { superseded = false } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const turnId = String(turn?.turnId || "");
  const text = String(turn?.assistantContent || "").trim();
  if (superseded || !text) {
    return {
      messages: dropTurnPlaceholder(dropLateTurnPlaceholder(list, turnId), turnId),
      painted: false,
    };
  }
  return {
    messages: mergeLateReplyIntoMessages(list, turn),
    painted: true,
  };
}

/**
 * Remove the placeholder bubble added while waiting on `turnId`. Bubbles for
 * other turns (a send that started meanwhile) stay.
 *
 * @param {Record<string, unknown>[] | null | undefined} messages
 * @param {string} turnId
 */
export function dropLateTurnPlaceholder(messages, turnId) {
  return (messages || []).filter(
    (message) =>
      !(
        message &&
        (message.character_name === "__typing__" ||
          message.character_name === "__thinking__") &&
        message.late_turn_id === turnId
      ),
  );
}

/**
 * Poll until the turn has assistant text, fails, or the window ends.
 *
 * @param {{
 *   fetchTurn: () => Promise<Record<string, unknown> | null | undefined>,
 *   timeoutMs?: number,
 *   intervalMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} args
 */
export async function pollLateCompanionReply({
  fetchTurn,
  timeoutMs = 45_000,
  intervalMs = 1_500,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started <= timeoutMs) {
    try {
      last = await fetchTurn();
    } catch (err) {
      const status =
        err && typeof err === "object"
          ? /** @type {{ status?: unknown }} */ (err).status
          : undefined;
      // This turn was never saved. Waiting out the full window only leaves
      // the typing bubble up.
      if (status === 404) {
        return { persistence_status: "failed", assistant_content: "" };
      }
      // The next tick retries. A dropped poll is not a failed reply.
    }
    const text = String(last?.assistant_content || "").trim();
    if (text) return last;
    if (last?.persistence_status === "failed") return last;
    if (Date.now() - started >= timeoutMs) break;
    await sleep(intervalMs);
  }
  return last;
}
