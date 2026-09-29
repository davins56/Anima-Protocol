/**
 * A second text while this conversation is already replying stays on the
 * client. The server still refuses a concurrent turn (`conversation_busy`)
 * so two Ollama runs cannot start, and the same line is not applied to
 * mood or memory twice.
 *
 * Several texts typed during that wait are combined into one turn. She
 * answers them together, one model run, and Cancel drops the whole burst.
 * The note on the pending bubble is the same line the stream used to show
 * for "one reply ahead", so the thread has one waiting sentence.
 */

export const HELD_SEND_NOTE = "Sends when she's done";

export const COMPOSER_TERMINAL_REASONS = [
  "reply_finished",
  "error",
  "first_token_timeout",
  "recovery_check_ended",
];

/**
 * @param {unknown} message
 * @returns {string}
 */
export function outgoingText(message) {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return "";
  const text = /** @type {{ text?: unknown }} */ (message).text;
  return typeof text === "string" ? text : "";
}

/**
 * @param {unknown} message
 * @returns {unknown[]}
 */
export function outgoingAttachments(message) {
  if (!message || typeof message !== "object") return [];
  const attachments = /** @type {{ attachments?: unknown }} */ (message).attachments;
  return Array.isArray(attachments) ? attachments : [];
}

/**
 * A real follow-up (text or files). An empty Continue is not held.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isHoldableOutgoing(message) {
  return Boolean(outgoingText(message).trim()) || outgoingAttachments(message).length > 0;
}

/**
 * @param {unknown} message
 * @returns {string | { text: string, attachments: unknown[] }}
 */
export function normalizeOutgoingPayload(message) {
  const text = outgoingText(message).trim();
  const attachments = outgoingAttachments(message);
  if (attachments.length) return { text, attachments };
  return text;
}

/**
 * @param {unknown} older
 * @param {unknown} newer
 * @returns {string | { text: string, attachments: unknown[] }}
 */
export function combineOutgoingPayload(older, newer) {
  const text = [outgoingText(older).trim(), outgoingText(newer).trim()]
    .filter(Boolean)
    .join("\n\n");
  const attachments = [...outgoingAttachments(older), ...outgoingAttachments(newer)];
  if (attachments.length) return { text, attachments };
  return text;
}

/**
 * @param {string | { text: string, attachments?: unknown[] }} payload
 * @returns {string}
 */
export function heldOutgoingLabel(payload) {
  const text = outgoingText(payload).trim();
  if (text) return text;
  const count = outgoingAttachments(payload).length;
  if (count === 1) return "Attachment";
  if (count > 1) return `${count} attachments`;
  return "";
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isConversationBusyError(err) {
  if (!err || typeof err !== "object") return false;
  const error = /** @type {{ code?: unknown, message?: unknown }} */ (err);
  if (error.code === "conversation_busy") return true;
  return /still finishing the last reply/i.test(String(error.message || ""));
}

/**
 * The 90s first-token budget (local slot) or the browser abort that wraps it.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isFirstTokenTimeoutError(err) {
  if (!err || typeof err !== "object") return false;
  const error = /** @type {{ code?: unknown, message?: unknown }} */ (err);
  if (error.code === "chat_stream_timeout") return true;
  return /took too long/i.test(String(error.message || ""));
}

/**
 * Which unlock path just finished. A recovery poll replaces the timeout
 * reason because the composer stays closed until that check ends.
 *
 * @param {unknown} err
 * @param {{ recovered?: boolean }} [options]
 * @returns {"error" | "first_token_timeout" | "recovery_check_ended"}
 */
export function composerTerminalReason(err, { recovered = false } = {}) {
  if (recovered) return "recovery_check_ended";
  if (isFirstTokenTimeoutError(err)) return "first_token_timeout";
  return "error";
}

/**
 * Another tab's turn is still generating. A saved reply or a failed row is clear.
 *
 * @param {unknown} live
 * @returns {boolean}
 */
export function liveTurnStillBlocking(live) {
  if (!live || typeof live !== "object") return false;
  const row = /** @type {{ turn_id?: unknown, assistant_content?: unknown, persistence_status?: unknown }} */ (
    live
  );
  if (!row.turn_id) return false;
  if (String(row.assistant_content || "").trim()) return false;
  return row.persistence_status === "pending" || row.persistence_status === "generated";
}

/**
 * Drop the optimistic user line and thinking bubble for a turn the server refused.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} messages
 * @param {unknown} turnId
 */
export function omitTurnMessages(messages, turnId) {
  const id = String(turnId || "");
  if (!id) return messages || [];
  return (messages || []).filter((message) => {
    if (!message) return false;
    if (message.turn_id === id || message.late_turn_id === id) return false;
    return true;
  });
}

/**
 * Continue / regenerate stay locked only for the session that is replying.
 * The text box is never locked — a follow-up is held instead.
 *
 * @param {{ inFlightSessionId?: string | null, busyRetrySessionId?: string | null }} snapshot
 * @param {string | null | undefined} sessionId
 */
export function sessionControlsLocked(snapshot, sessionId) {
  if (!sessionId) return false;
  if (snapshot?.inFlightSessionId === sessionId) return true;
  if (snapshot?.busyRetrySessionId === sessionId) return true;
  return false;
}

/**
 * @param {{ textLocked: boolean, continueLocked: boolean, regenerateLocked: boolean, inFlight: boolean }} snapshot
 * @returns {boolean}
 */
export function composerFullyUnlocked(snapshot) {
  return (
    snapshot.textLocked === false &&
    snapshot.continueLocked === false &&
    snapshot.regenerateLocked === false &&
    snapshot.inFlight === false
  );
}

/**
 * @returns {{
 *   accept: (sessionId: string, message: unknown) => { action: "send" | "held" | "ignore", ownerToken: number | null },
 *   revertSendToHold: (sessionId: string, message: unknown, ownerToken: number) => void,
 *   noteBusy: (sessionId: string, message: unknown, ownerToken: number) => void,
 *   clearBusyRetry: (sessionId: string) => void,
 *   release: (reason: string, ownerToken: number) => { ignored: boolean },
 *   detachSession: (sessionId: string) => void,
 *   takeHeld: (sessionId: string) => unknown,
 *   cancel: (sessionId: string, id: string) => void,
 *   beginAwait: (sessionId: string) => number,
 *   snapshot: () => {
 *     textLocked: boolean,
 *     continueLocked: boolean,
 *     regenerateLocked: boolean,
 *     inFlight: boolean,
 *     inFlightSessionId: string | null,
 *     busyRetrySessionId: string | null,
 *     ownerToken: number,
 *     heldBySession: Record<string, { id: string, sessionId: string, payload: unknown, text: string }>,
 *     lastReason: string | null,
 *   },
 * }}
 */
export function createComposerGate() {
  let seq = 0;
  const heldBySession = {};
  const gate = {
    textLocked: false,
    continueLocked: false,
    regenerateLocked: false,
    inFlight: false,
    inFlightSessionId: /** @type {string | null} */ (null),
    busyRetrySessionId: /** @type {string | null} */ (null),
    ownerToken: 0,
    lastReason: /** @type {string | null} */ (null),
  };

  const snapshot = () => ({
    textLocked: gate.textLocked,
    continueLocked: gate.continueLocked,
    regenerateLocked: gate.regenerateLocked,
    inFlight: gate.inFlight,
    inFlightSessionId: gate.inFlightSessionId,
    busyRetrySessionId: gate.busyRetrySessionId,
    ownerToken: gate.ownerToken,
    heldBySession: { ...heldBySession },
    lastReason: gate.lastReason,
  });

  const lockControls = (sessionId) => {
    gate.inFlight = true;
    gate.inFlightSessionId = sessionId;
    gate.continueLocked = true;
    gate.regenerateLocked = true;
    gate.textLocked = false;
  };

  const unlockControls = () => {
    gate.inFlight = false;
    gate.inFlightSessionId = null;
    gate.continueLocked = false;
    gate.regenerateLocked = false;
    gate.textLocked = false;
  };

  /**
   * @param {string} sessionId
   * @param {unknown} message
   * @param {"append" | "prepend"} place
   */
  const writeHeld = (sessionId, message, place) => {
    if (!isHoldableOutgoing(message)) return;
    const incoming = normalizeOutgoingPayload(message);
    const prev = heldBySession[sessionId];
    const payload = prev
      ? place === "prepend"
        ? combineOutgoingPayload(incoming, prev.payload)
        : combineOutgoingPayload(prev.payload, incoming)
      : incoming;
    heldBySession[sessionId] = {
      id: prev?.id || `held_${++seq}`,
      sessionId,
      payload,
      text: heldOutgoingLabel(payload),
    };
  };

  return {
    snapshot,

    accept(sessionId, message) {
      const waitingHere =
        (gate.inFlight && gate.inFlightSessionId === sessionId) ||
        gate.busyRetrySessionId === sessionId;
      if (waitingHere) {
        if (!isHoldableOutgoing(message)) return { action: "ignore", ownerToken: null };
        writeHeld(sessionId, message, "append");
        return { action: "held", ownerToken: null };
      }
      gate.ownerToken += 1;
      lockControls(sessionId);
      return { action: "send", ownerToken: gate.ownerToken };
    },

    revertSendToHold(sessionId, message, ownerToken) {
      if (ownerToken !== gate.ownerToken) return;
      if (isHoldableOutgoing(message)) writeHeld(sessionId, message, "append");
      // The send never started. Leave the line held and the controls open
      // so it can go out once the other lock drops.
      unlockControls();
    },

    noteBusy(sessionId, message, ownerToken) {
      if (ownerToken !== gate.ownerToken) return;
      gate.inFlight = false;
      gate.inFlightSessionId = null;
      gate.busyRetrySessionId = sessionId;
      gate.continueLocked = true;
      gate.regenerateLocked = true;
      gate.textLocked = false;
      gate.lastReason = "error";
      writeHeld(sessionId, message, "prepend");
    },

    clearBusyRetry(sessionId) {
      if (gate.busyRetrySessionId === sessionId) gate.busyRetrySessionId = null;
      if (!gate.inFlight) {
        gate.continueLocked = false;
        gate.regenerateLocked = false;
        gate.textLocked = false;
      }
    },

    release(reason, ownerToken) {
      if (ownerToken !== gate.ownerToken) return { ignored: true };
      unlockControls();
      gate.lastReason = reason;
      return { ignored: false };
    },

    detachSession(sessionId) {
      if (gate.inFlightSessionId !== sessionId && gate.busyRetrySessionId !== sessionId) return;
      gate.ownerToken += 1;
      unlockControls();
    },

    takeHeld(sessionId) {
      if (gate.inFlight && gate.inFlightSessionId === sessionId) return null;
      if (gate.busyRetrySessionId === sessionId) return null;
      const held = heldBySession[sessionId];
      if (!held) return null;
      delete heldBySession[sessionId];
      return held.payload;
    },

    cancel(sessionId, id) {
      const held = heldBySession[sessionId];
      if (!held || held.id !== id) return;
      delete heldBySession[sessionId];
      if (gate.busyRetrySessionId === sessionId) {
        gate.busyRetrySessionId = null;
        if (!gate.inFlight) {
          gate.continueLocked = false;
          gate.regenerateLocked = false;
          gate.textLocked = false;
        }
      }
    },

    beginAwait(sessionId) {
      if (gate.inFlight && gate.inFlightSessionId === sessionId) return gate.ownerToken;
      gate.ownerToken += 1;
      lockControls(sessionId);
      return gate.ownerToken;
    },
  };
}
