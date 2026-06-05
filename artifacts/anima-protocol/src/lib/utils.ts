import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const isIframe = window.self !== window.top;

// Count a chat session's messages WITHOUT hydrating its full history. Sessions
// are loaded metadata-only (ChatSession.list with { withMessages: false }); a
// migrated session has an empty `messages` blob and its messages live as rows
// counted server-side (passed in via `counts`), while a session not yet migrated
// still carries its legacy `messages` blob, so use the blob length for those.
// This keeps XP/rank totals correct for both old and new data without pulling
// every session's messages on screen open.
export function sessionMessageCount(
  session: { messages?: unknown[]; id?: string } | null | undefined,
  counts: Record<string, number> | null | undefined,
): number {
  if (Array.isArray(session?.messages) && session.messages.length > 0) {
    return session.messages.length;
  }
  const id = session?.id;
  return (counts && id != null && counts[id]) || 0;
}
