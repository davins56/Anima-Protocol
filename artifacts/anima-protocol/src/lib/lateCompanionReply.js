/**
 * A slow self-hosted reply is still in flight.
 * The chat page keeps the user line and the typing indicator, then polls
 * until the server saves the answer. It must not toast the generic failure.
 */

export const GENERIC_COMPANION_COULD_NOT_REPLY =
  "The companion could not reply. Please try again.";

const TOOK_TOO_LONG_RE = /took too long/i;

/**
 * @param {unknown} err
 * @returns {boolean}
 */
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
 * @param {Array<Record<string, unknown>> | null | undefined} messages
 * @param {{
 *   turnId: string,
 *   userContent?: string,
 *   assistantContent?: string,
 *   characterName?: string | null,
 * }} turn
 */
export function mergeLateReplyIntoMessages(messages, turn) {
  const turnId = String(turn.turnId || "");
  const userId = `${turnId}:user`;
  const assistantId = `${turnId}:assistant`;
  const kept = (messages || []).filter((message) => {
    if (!message) return false;
    if (message.character_name === "__typing__" || message.character_name === "__thinking__") {
      return false;
    }
    if (message.id === userId || message.id === assistantId) return false;
    return true;
  });
  const next = [...kept];
  const userContent = String(turn.userContent || "");
  if (userContent.trim()) {
    next.push({
      id: userId,
      turn_id: turnId,
      role: "user",
      content: userContent,
      timestamp: new Date().toISOString(),
    });
  }
  const assistantContent = String(turn.assistantContent || "");
  if (assistantContent.trim()) {
    next.push({
      id: assistantId,
      turn_id: turnId,
      role: "assistant",
      content: assistantContent,
      character_name: turn.characterName || "Character",
      timestamp: new Date().toISOString(),
    });
  }
  return next;
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
