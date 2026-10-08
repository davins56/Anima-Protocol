/**
 * Retry / edit-resend on the existing /chat/messages path.
 *
 * Retry must not insert another user row. Both actions reuse one generate
 * and must not write mood, memory, or relationship again — the original turn
 * already counted. Chat stays on the self-hosted model; these flags never
 * select a cloud provider.
 */

export type ReplyAction = "retry" | "edit";

export function replyActionOf(value: unknown): ReplyAction | null {
  return value === "retry" || value === "edit" ? value : null;
}

export function turnSkipsAffect(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata) return false;
  if (metadata.skip_affect === true) return true;
  return replyActionOf(metadata.reply_action) != null;
}

/** Continue and Retry already have his line on the thread. Do not write it again. */
export function omitPersistedUserRow(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata) return false;
  if (metadata.is_continue === true) return true;
  return metadata.reply_action === "retry";
}

/** The previous turn was replaced. A late save must not write that reply again. */
export function turnMetadataReplaced(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as { replaced?: unknown }).replaced === true;
}

export function replacedTurnIdOf(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as { replaced_turn_id?: unknown }).replaced_turn_id;
  return typeof value === "string" ? value.trim() : "";
}

/** First stored row of the suffix. The server deletes from that row's seq down. */
export function replacedFromMessageIdOf(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as { replaced_from_message_id?: unknown }).replaced_from_message_id;
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 200) return "";
  return id;
}

export function messageSeq(message: unknown): number | null {
  if (!message || typeof message !== "object") return null;
  const seq = (message as { seq?: unknown }).seq;
  if (typeof seq === "number" && Number.isFinite(seq)) return seq;
  if (typeof seq === "string" && seq.trim() !== "" && Number.isFinite(Number(seq))) {
    return Number(seq);
  }
  return null;
}

/** Ids the client already dropped from the thread. Capped so a retry cannot wipe the session. */
export function replacedMessageIdsOf(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const raw = (metadata as { replaced_message_ids?: unknown }).replaced_message_ids;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    const id = String(item || "").trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= 40) break;
  }
  return ids;
}

const MESSAGE_ROLE_SUFFIX = /:(?:user|assistant|event)(?::\d+)?$/;

/**
 * Turn id stored on a chat row, or the id with a `:user` / `:assistant` /
 * `:event` suffix removed. Turn ids may themselves contain colons.
 */
export function messageTurnId(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const row = message as {
    turn_id?: unknown;
    late_turn_id?: unknown;
    id?: unknown;
    metadata?: unknown;
  };
  if (row.turn_id) return String(row.turn_id);
  if (row.late_turn_id) return String(row.late_turn_id);
  const metadata = row.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const nested = (metadata as { turn_id?: unknown }).turn_id;
    if (nested) return String(nested);
  }
  const id = String(row.id || "");
  const suffix = MESSAGE_ROLE_SUFFIX.exec(id);
  return suffix && suffix.index > 0 ? id.slice(0, suffix.index) : "";
}

/**
 * True when this stored row is the reply a retry or edit is replacing.
 * An explicit id is removed even when it is his line (edit rewrote it).
 * Matching the turn id removes her reply and placeholders, and leaves his line.
 */
function replacedTurnIds(
  target: { turnId?: string | null; turnIds?: readonly string[] | null },
): Set<string> {
  const ids = new Set<string>();
  const primary = String(target.turnId || "").trim();
  if (primary) ids.add(primary);
  for (const item of target.turnIds || []) {
    const id = String(item || "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * True when this stored row is part of the reply a retry or edit is replacing.
 * A seq at or after the verified anchor removes the whole suffix, including
 * later user lines. An explicit id cannot reach a row that sorts before that
 * anchor. Matching a replaced turn removes her reply and leaves his line
 * unless the boundary already includes it.
 */
export function shouldDiscardStoredMessage(
  message: unknown,
  target: {
    turnId?: string | null;
    turnIds?: readonly string[] | null;
    messageIds?: readonly string[] | null;
    fromSeq?: number | null;
  },
): boolean {
  if (!message || typeof message !== "object") return false;
  const row = message as { id?: unknown; role?: unknown };
  const seq = messageSeq(message);
  const fromSeq = target.fromSeq;
  if (fromSeq != null && seq != null && seq >= fromSeq) return true;
  const id = String(row.id || "");
  const listed = target.messageIds || [];
  const listedHit = Boolean(id && listed.some((item) => item === id));
  if (listedHit && (fromSeq == null || seq == null || seq >= fromSeq)) {
    if (fromSeq != null || seq == null) return true;
    const turns = replacedTurnIds(target);
    if (turns.size === 0 || turns.has(messageTurnId(message))) return true;
  }
  if (row.role === "user") return false;
  const turns = replacedTurnIds(target);
  if (turns.size === 0) return false;
  return turns.has(messageTurnId(message));
}
