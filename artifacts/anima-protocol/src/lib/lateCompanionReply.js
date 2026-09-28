/**
 * A slow self-hosted reply is still in flight.
 * The chat page keeps the user line and the typing indicator, then polls
 * until the server saves the answer. It must not toast the generic failure.
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

export function mergeLateReplyIntoMessages(messages, turn) {
  const turnId = String(turn.turnId || "");
  const userId = `${turnId}:user`;
  const assistantId = `${turnId}:assistant`;
  const source = (messages || []).filter((message) => {
    if (!message) return false;
    if (message.character_name === "__typing__" || message.character_name === "__thinking__") {
      return false;
    }
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
    });
  }
  kept.splice(insertAt, 0, ...block);
  return kept;
}

/**
 * How long the page waits on a late reply before taking the "..." bubble
 * down. Covers the local slot queue (`LLM_LOCAL_SLOT_WAIT_MS`, 180s) plus
 * the generation cap (`LLM_LOCAL_FIRST_TOKEN_MS` 90s + `LLM_LOCAL_DECODE_SLACK_MS` 30s).
 */
export const LATE_REPLY_POLL_MS = 300_000;

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
    } catch {
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
