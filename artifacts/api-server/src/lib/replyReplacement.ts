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
