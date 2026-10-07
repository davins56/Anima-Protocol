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

/** Turn id stored on a chat row, or the prefix of `turn_x:assistant`. */
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
  const marker = id.indexOf(":");
  return marker > 0 ? id.slice(0, marker) : "";
}

/**
 * True when this stored row is the reply a retry or edit is replacing.
 * An explicit id is removed even when it is his line (edit rewrote it).
 * Matching the turn id removes her reply and placeholders, and leaves his line.
 */
export function shouldDiscardStoredMessage(
  message: unknown,
  target: { turnId?: string | null; messageIds?: readonly string[] | null },
): boolean {
  if (!message || typeof message !== "object") return false;
  const row = message as { id?: unknown; role?: unknown };
  const id = String(row.id || "");
  const listed = target.messageIds || [];
  if (id && listed.some((item) => item === id)) return true;
  if (row.role === "user") return false;
  const turnId = String(target.turnId || "");
  if (!turnId) return false;
  return messageTurnId(message) === turnId;
}
