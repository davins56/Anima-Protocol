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
 *
 * The hold is also written to localStorage for this account and conversation.
 * A reload (common when iPhone Safari discards the tab) puts that text back
 * in the send box for review. It does not send on its own: her reply may
 * already have landed. The saved copy stays until the user sends from that
 * box, clears the box, the in-memory hold sends or is cancelled, or 24 hours
 * pass. A later reload puts it back again.
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
export function isReplyReplacement(message) {
  if (!message || typeof message !== "object") return false;
  const action = /** @type {{ replyAction?: unknown }} */ (message).replyAction;
  return action === "retry" || action === "edit";
}

export function isHoldableOutgoing(message) {
  // Retry and edit must not sit in the #545 queue. A later flush would send
  // them as a normal user turn and count mood twice.
  if (isReplyReplacement(message)) return false;
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
 * `onHeldChange` fires with the combined payload whenever a hold is written,
 * and with `null` when that hold is taken to send or cancelled. Storage
 * failures inside the callback must not break the composer; the gate also
 * swallows throws.
 *
 * @param {{ onHeldChange?: (sessionId: string, payload: unknown | null) => void }} [options]
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
export function createComposerGate({ onHeldChange } = {}) {
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

  const notifyHeld = (sessionId) => {
    if (typeof onHeldChange !== "function") return;
    try {
      const held = heldBySession[sessionId];
      onHeldChange(sessionId, held ? held.payload : null);
    } catch {
      // A full or blocked localStorage must not stop the send.
    }
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
    notifyHeld(sessionId);
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
      notifyHeld(sessionId);
      return held.payload;
    },

    cancel(sessionId, id) {
      const held = heldBySession[sessionId];
      if (!held || held.id !== id) return;
      delete heldBySession[sessionId];
      notifyHeld(sessionId);
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

/** Per-account, per-conversation key so two logins on one phone do not share a draft. */
export const HELD_DRAFT_STORAGE_PREFIX = "anima.heldChatSend.v1";

/** A tab killed overnight should not resurrect a stale follow-up. */
export const HELD_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const RESTORED_HELD_NOTE = "Your unsent message is back in the box.";

export const RESTORED_HELD_ATTACHMENT_NOTE =
  "Your unsent message is back in the box. The attachment wasn't kept.";

export const RESTORED_HELD_ATTACHMENT_ONLY_NOTE = "The attachment wasn't kept.";

/**
 * @param {unknown} userId
 * @param {unknown} sessionId
 * @returns {string | null}
 */
export function heldDraftStorageKey(userId, sessionId) {
  const user = typeof userId === "string" ? userId.trim() : "";
  const session = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!user || !session) return null;
  return `${HELD_DRAFT_STORAGE_PREFIX}:${encodeURIComponent(user)}:${encodeURIComponent(session)}`;
}

/**
 * localStorage is missing in some private-mode browsers and throws on access.
 * @returns {Storage | null}
 */
export function browserLocalStorage() {
  try {
    if (typeof globalThis.localStorage === "undefined" || globalThis.localStorage == null) {
      return null;
    }
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Already-uploaded media only. Files, blobs, and data/blob URLs cannot
 * survive a reload, so they are left out of storage.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isUploadedAttachmentUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048 || trimmed !== url) return false;
  if (/[\u0000-\u001F\u007F\\]/.test(trimmed)) return false;
  if (/^(javascript|data|blob|file|vbscript):/i.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.username || parsed.password) return false;
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }
  // Same-origin upload path (`/api/storage/objects/uploads/...`).
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false;
  if (trimmed.includes("..")) return false;
  return true;
}

/**
 * @param {unknown} attachment
 * @returns {{ url: string, type: "image" | "audio", name?: string } | null}
 */
export function restorableAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  if (typeof File !== "undefined" && attachment instanceof File) return null;
  if (typeof Blob !== "undefined" && attachment instanceof Blob) return null;
  const record = /** @type {{ url?: unknown, type?: unknown, name?: unknown }} */ (attachment);
  if (!isUploadedAttachmentUrl(record.url)) return null;
  const type = record.type === "audio" ? "audio" : record.type === "image" ? "image" : null;
  if (!type) return null;
  const restored = { url: String(record.url).trim(), type };
  if (typeof record.name === "string") {
    const name = record.name.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 180);
    if (name) restored.name = name;
  }
  return restored;
}

/**
 * @param {unknown} message
 * @param {number} [now]
 * @returns {{ savedAt: number, text: string, attachments: { url: string, type: "image" | "audio", name?: string }[], droppedAttachmentCount: number } | null}
 */
export function draftFromOutgoing(message, now = Date.now()) {
  const text = outgoingText(message).trim();
  const kept = [];
  let droppedAttachmentCount = 0;
  for (const attachment of outgoingAttachments(message)) {
    const safe = restorableAttachment(attachment);
    if (safe) kept.push(safe);
    else droppedAttachmentCount += 1;
  }
  if (!text && kept.length === 0 && droppedAttachmentCount === 0) return null;
  return { savedAt: now, text, attachments: kept, droppedAttachmentCount };
}

/**
 * @param {HeldDraftStorage | null | undefined} storage
 * @returns {string[]}
 */
function listStorageKeys(storage) {
  if (!storage) return [];
  try {
    const length = storage.length;
    if (typeof length !== "number" || typeof storage.key !== "function") return [];
    const keys = [];
    for (let i = 0; i < length; i += 1) {
      const key = storage.key(i);
      if (typeof key === "string") keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * @param {HeldDraftStorage | null | undefined} storage
 * @param {number} [now]
 */
export function sweepExpiredHeldDrafts(storage, now = Date.now()) {
  if (!storage) return;
  for (const key of listStorageKeys(storage)) {
    if (!key.startsWith(`${HELD_DRAFT_STORAGE_PREFIX}:`)) continue;
    try {
      const raw = storage.getItem(key);
      const savedAt = Number(JSON.parse(raw || "null")?.savedAt);
      if (!Number.isFinite(savedAt) || now - savedAt > HELD_DRAFT_MAX_AGE_MS) {
        storage.removeItem(key);
      }
    } catch {
      try {
        storage.removeItem(key);
      } catch {
        // Leave the bad entry. Chat still works.
      }
    }
  }
}

/**
 * @param {unknown} parsed
 * @param {number} now
 * @returns {{ savedAt: number, text: string, attachments: { url: string, type: "image" | "audio", name?: string }[], droppedAttachmentCount: number } | null}
 */
function normalizeStoredDraft(parsed, now) {
  if (!parsed || typeof parsed !== "object") return null;
  const record = /** @type {{ savedAt?: unknown, text?: unknown, droppedAttachmentCount?: unknown }} */ (
    parsed
  );
  const savedAt = Number(record.savedAt);
  if (!Number.isFinite(savedAt) || now - savedAt > HELD_DRAFT_MAX_AGE_MS) return null;
  const draftText = typeof record.text === "string" ? record.text.trim() : "";
  const attachments = [];
  let droppedAttachmentCount = Math.max(0, Number(record.droppedAttachmentCount) || 0);
  for (const attachment of outgoingAttachments(parsed)) {
    const safe = restorableAttachment(attachment);
    if (safe) attachments.push(safe);
    else droppedAttachmentCount += 1;
  }
  if (!draftText && attachments.length === 0 && droppedAttachmentCount === 0) return null;
  return { savedAt, text: draftText, attachments, droppedAttachmentCount };
}

/**
 * @param {HeldDraftStorage | null | undefined} storage
 * @param {unknown} userId
 * @param {unknown} sessionId
 * @param {unknown} message
 * @param {number} [now]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function writeHeldDraft(storage, userId, sessionId, message, now = Date.now()) {
  const key = heldDraftStorageKey(userId, sessionId);
  if (!key) return { ok: false, reason: "missing_key" };
  if (!storage) return { ok: false, reason: "unavailable" };
  const draft = draftFromOutgoing(message, now);
  let savedAt = draft ? draft.savedAt : null;
  try {
    if (!draft) {
      storage.removeItem(key);
    } else {
      savedAt = preservedDraftSavedAt(storage, key, draft, now);
      storage.setItem(key, JSON.stringify({ ...draft, savedAt }));
    }
  } catch {
    return { ok: false, reason: "storage_failed" };
  }
  try {
    sweepExpiredHeldDrafts(storage, now);
  } catch {
    // Expiry is best-effort.
  }
  return { ok: true, savedAt };
}

/**
 * Rewriting the same follow-up should not look like a new draft. A different
 * body, or a stamp that is already expired, gets a fresh savedAt.
 *
 * @param {HeldDraftStorage} storage
 * @param {string} key
 * @param {{ text: string, attachments: unknown[], droppedAttachmentCount: number, savedAt: number }} draft
 * @param {number} now
 */
function preservedDraftSavedAt(storage, key, draft, now) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return draft.savedAt;
    const prior = JSON.parse(raw);
    const priorSavedAt = Number(prior?.savedAt);
    if (!Number.isFinite(priorSavedAt) || now - priorSavedAt > HELD_DRAFT_MAX_AGE_MS) {
      return draft.savedAt;
    }
    if (draftBodyKey(prior) !== draftBodyKey(draft)) return draft.savedAt;
    return priorSavedAt;
  } catch {
    return draft.savedAt;
  }
}

/**
 * @param {{ text?: unknown, attachments?: unknown, droppedAttachmentCount?: unknown }} record
 */
function draftBodyKey(record) {
  const text = typeof record?.text === "string" ? record.text : "";
  const attachments = Array.isArray(record?.attachments) ? record.attachments : [];
  const droppedAttachmentCount = Math.max(0, Number(record?.droppedAttachmentCount) || 0);
  return JSON.stringify({ text, attachments, droppedAttachmentCount });
}

/**
 * Remove the saved follow-up only when it is still the draft that was read.
 * Another tab may have stored a newer one since then.
 *
 * @param {HeldDraftStorage | null | undefined} storage
 * @param {unknown} userId
 * @param {unknown} sessionId
 * @param {unknown} savedAt
 * @returns {{ ok: boolean, reason?: string }}
 */
export function clearHeldDraftIfUnchanged(storage, userId, sessionId, savedAt) {
  const key = heldDraftStorageKey(userId, sessionId);
  if (!key) return { ok: false, reason: "missing_key" };
  if (!storage) return { ok: false, reason: "unavailable" };
  const expected = Number(savedAt);
  if (!Number.isFinite(expected)) return { ok: false, reason: "missing_saved_at" };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { ok: true, reason: "absent" };
    const current = Number(JSON.parse(raw)?.savedAt);
    if (current !== expected) return { ok: true, reason: "changed" };
    storage.removeItem(key);
    return { ok: true };
  } catch {
    return { ok: false, reason: "storage_failed" };
  }
}

/**
 * Once a draft has been copied into the send box, drop that React payload.
 * ChatInput remounts when the conversation changes, and a leftover payload
 * would paste the same text in again.
 *
 * @param {{ token?: string } | null | undefined} current
 * @param {{ token?: string } | null | undefined} applied
 */
export function dropAppliedComposerRestore(current, applied) {
  if (!current) return null;
  if (applied?.token && current.token === applied.token) return null;
  return current;
}

/**
 * @param {HeldDraftStorage | null | undefined} storage
 * @param {unknown} userId
 * @param {unknown} sessionId
 * @returns {{ ok: boolean, reason?: string }}
 */
export function clearHeldDraft(storage, userId, sessionId) {
  const key = heldDraftStorageKey(userId, sessionId);
  if (!key) return { ok: false, reason: "missing_key" };
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    storage.removeItem(key);
    return { ok: true };
  } catch {
    return { ok: false, reason: "storage_failed" };
  }
}

/**
 * @param {HeldDraftStorage | null | undefined} storage
 * @param {unknown} userId
 * @param {unknown} sessionId
 * @param {number} [now]
 */
export function readHeldDraft(storage, userId, sessionId, now = Date.now()) {
  const key = heldDraftStorageKey(userId, sessionId);
  if (!key || !storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) {
    try {
      sweepExpiredHeldDrafts(storage, now);
    } catch {
      // ignore
    }
    return null;
  }
  try {
    const draft = normalizeStoredDraft(JSON.parse(raw), now);
    if (!draft) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
    try {
      sweepExpiredHeldDrafts(storage, now);
    } catch {
      // ignore
    }
    return draft;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * The saved line is already the whole box, or one of the paragraphs in it.
 *
 * @param {string} current
 * @param {string} saved
 */
function composerHasParagraph(current, saved) {
  if (current.trim() === saved) return true;
  return current.split(/\n\n/).some((part) => part.trim() === saved);
}

/**
 * @param {{ placedText: boolean, placedAttachment: boolean, droppedAttachmentCount: number }} result
 * @returns {string}
 */
export function noteForRestoredDraft({ placedText, placedAttachment, droppedAttachmentCount }) {
  const dropped = droppedAttachmentCount > 0;
  if (!placedText && !placedAttachment && !dropped) return "";
  if (!placedText && !placedAttachment && dropped) return RESTORED_HELD_ATTACHMENT_ONLY_NOTE;
  if (dropped) return RESTORED_HELD_ATTACHMENT_NOTE;
  return RESTORED_HELD_NOTE;
}

/**
 * Put a saved follow-up back into the send box.
 * Text the user already typed wins: the saved line is appended after a
 * blank line when it is not already one of the paragraphs. An exact copy
 * is left as-is so the box is not doubled.
 *
 * @param {{ text?: string, attachments?: unknown[] }} current
 * @param {{ text?: string, attachments?: unknown[], droppedAttachmentCount?: number } | null | undefined} draft
 */
export function mergeDraftIntoComposer(current, draft) {
  const currentText = typeof current?.text === "string" ? current.text : "";
  const savedText = typeof draft?.text === "string" ? draft.text.trim() : "";
  const currentAttachments = Array.isArray(current?.attachments) ? current.attachments : [];
  const savedAttachments = Array.isArray(draft?.attachments) ? draft.attachments : [];
  const droppedAttachmentCount = Math.max(0, Number(draft?.droppedAttachmentCount) || 0);

  let text = currentText;
  let placedText = false;
  if (savedText) {
    if (!currentText.trim()) {
      text = savedText;
      placedText = true;
    } else if (!composerHasParagraph(currentText, savedText)) {
      text = `${currentText.replace(/\s+$/, "")}\n\n${savedText}`;
      placedText = true;
    }
  }

  const seen = new Set();
  const attachments = [];
  for (const attachment of currentAttachments) {
    attachments.push(attachment);
    if (attachment && typeof attachment === "object" && typeof attachment.url === "string") {
      seen.add(attachment.url);
    }
  }
  let placedAttachment = false;
  for (const attachment of savedAttachments) {
    const safe = restorableAttachment(attachment);
    if (!safe || seen.has(safe.url)) continue;
    seen.add(safe.url);
    attachments.push(safe);
    placedAttachment = true;
  }

  return {
    text,
    attachments,
    placedText,
    placedAttachment,
    changed: placedText || placedAttachment,
    note: noteForRestoredDraft({ placedText, placedAttachment, droppedAttachmentCount }),
  };
}

/**
 * Decide what to do with a saved hold when a conversation opens.
 * A draft is never sent from here. An in-memory hold stays on the auto-send
 * path (#545). A draft found only in storage goes back to the send box.
 *
 * @param {HeldDraftStorage | null | undefined} storage
 * @param {{
 *   userId?: unknown,
 *   sessionId?: unknown,
 *   inMemoryPayload?: unknown,
 *   alreadyClaimed?: boolean,
 *   now?: number,
 * }} [options]
 */
export function consumeHeldDraftForOpen(storage, {
  userId,
  sessionId,
  inMemoryPayload = null,
  alreadyClaimed = false,
  now = Date.now(),
} = {}) {
  if (!userId || !sessionId) return { action: "wait", send: false, claim: false };
  if (isHoldableOutgoing(inMemoryPayload)) {
    const written = writeHeldDraft(storage, userId, sessionId, inMemoryPayload, now);
    return { action: "keep_in_memory", send: false, claim: true, savedAt: written.savedAt ?? null };
  }
  if (alreadyClaimed) return { action: "idle", send: false, claim: false };
  if (!storage) return { action: "unavailable", send: false, claim: false };
  const draft = readHeldDraft(storage, userId, sessionId, now);
  // An empty look must not stick. Another tab can save a hold later.
  if (!draft) return { action: "none", send: false, claim: false };
  return { action: "restore_to_input", send: false, claim: true, draft };
}
