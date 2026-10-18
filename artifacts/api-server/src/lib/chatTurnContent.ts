/**
 * Gate for POST /chat/messages user text.
 *
 * The chat page sends `content` and top-level `is_continue` (boolean).
 * Continue also sends a non-empty first-person line, so a continue turn
 * passes even before the flag is read. Retry and edit resend his line as
 * `content` with `is_continue: false` and `metadata.reply_action`.
 * An empty body with no continue flag is rejected before any model call.
 */

export const EMPTY_CHAT_CONTENT_ERROR =
  "empty message content requires is_continue=true";

export function chatTurnContent(body: {
  content?: unknown;
  is_continue?: unknown;
}): { content: string; isContinue: boolean; error: string | null } {
  const content = String(body.content ?? "").trim();
  const isContinue = body.is_continue === true;
  if (!content && !isContinue) {
    return { content, isContinue, error: EMPTY_CHAT_CONTENT_ERROR };
  }
  return { content, isContinue, error: null };
}
