// Chat upgrade 6a: emoji reactions on her replies.
//
// Behind VITE_ANIMA_REACTIONS=1 (off by default). With the flag off nothing
// here runs and no message row gains a field.
//
// Storage (no migration): the reacted assistant row carries
// `user_reactions: ["❤️", ...]` inside its ChatMessage JSON. POST
// /messages/replace already keeps extra fields, and the save uses
// `keep_arrivals` so a reply that lands meanwhile is never dropped.
// Reactions are not sent to the model in this change.
import { animaClient } from "@/api/animaClient";

/** Build-time flag. "1", "true" or "on" turn it on; anything else is off. */
export function reactionsEnabled(env = import.meta.env) {
  const raw = String(env?.VITE_ANIMA_REACTIONS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** The fixed palette. Anything else on a row is ignored. */
export const REACTION_SET = Object.freeze(["❤️", "😂", "😮", "😢", "🔥", "👍"]);
export const REACTION_LABELS = Object.freeze({
  "❤️": "love",
  "😂": "laugh",
  "😮": "wow",
  "😢": "sad",
  "🔥": "fire",
  "👍": "thumbs up",
});
export const MAX_REACTIONS_PER_MESSAGE = 3;

const ALLOWED = new Set(REACTION_SET);

/** The user's reactions on a row, cleaned (palette only, no repeats, capped). */
export function userReactions(message) {
  const raw = message && Array.isArray(message.user_reactions) ? message.user_reactions : [];
  const out = [];
  for (const r of raw) {
    if (typeof r === "string" && ALLOWED.has(r) && !out.includes(r)) out.push(r);
    if (out.length >= MAX_REACTIONS_PER_MESSAGE) break;
  }
  return out;
}

/** A settled reply from her that has a stored id. */
export function canReactTo(message) {
  if (!message || typeof message !== "object") return false;
  if (message.role !== "assistant") return false;
  if (message.type === "event" || message.type === "ai_notice" || message.type === "crisis_resource") return false;
  const name = message.character_name;
  if (name === "__typing__" || name === "__thinking__") return false;
  if (message.is_streaming === true) return false;
  if (message.id == null || String(message.id) === "") return false;
  const content = String(message.content || "").trim();
  return content !== "" && content !== "...";
}

/**
 * Toggle one emoji. Adding past the cap drops the oldest. Unknown emoji leave
 * the list as it is.
 */
export function toggleReaction(current, emoji) {
  const list = Array.isArray(current) ? current.filter((r) => ALLOWED.has(r)) : [];
  if (!ALLOWED.has(emoji)) return list;
  if (list.includes(emoji)) return list.filter((r) => r !== emoji);
  const next = [...list, emoji];
  return next.length > MAX_REACTIONS_PER_MESSAGE ? next.slice(next.length - MAX_REACTIONS_PER_MESSAGE) : next;
}

/** Set a row's reactions by id. Returns the same array when nothing changed. */
export function withReactions(messages, messageId, reactions) {
  const list = Array.isArray(messages) ? messages : [];
  const id = String(messageId);
  const at = list.findIndex((m) => m && m.id != null && String(m.id) === id);
  if (at < 0) return { messages: list, found: false };
  const row = list[at];
  const before = userReactions(row);
  const same = before.length === reactions.length && before.every((r, i) => r === reactions[i]);
  if (same) return { messages: list, found: true };
  const next = list.slice();
  const { user_reactions: _drop, ...rest } = row;
  next[at] = reactions.length > 0 ? { ...rest, user_reactions: reactions } : rest;
  return { messages: next, found: true };
}

/**
 * Toggle a reaction and save it. Paints at once, then writes the row on the
 * freshest server copy. On failure the local paint is put back.
 *
 * @returns {Promise<{ ok: true, reactions: string[] } | { ok: false, reason: "busy" | "missing" | "invalid" | "error" }>}
 */
export async function reactToMessageFlow(messageId, emoji, { activeSession, isLoading, setActiveSession, client = animaClient }) {
  if (!activeSession?.id || messageId == null) return { ok: false, reason: "invalid" };
  if (!ALLOWED.has(emoji)) return { ok: false, reason: "invalid" };
  if (typeof isLoading === "function" ? isLoading() : isLoading) return { ok: false, reason: "busy" };
  const sessionId = activeSession.id;
  const row = (activeSession.messages || []).find((m) => m && m.id != null && String(m.id) === String(messageId));
  if (!row || !canReactTo(row)) return { ok: false, reason: "missing" };
  const before = userReactions(row);
  const after = toggleReaction(before, emoji);

  const paint = (reactions) =>
    setActiveSession((prev) => {
      if (!prev || prev.id !== sessionId) return prev;
      const { messages, found } = withReactions(prev.messages, messageId, reactions);
      return found && messages !== prev.messages ? { ...prev, messages } : prev;
    });

  paint(after);
  try {
    const fresh = await client.entities.ChatSession.get(sessionId);
    const { messages, found } = withReactions(fresh?.messages || [], messageId, after);
    if (!found) {
      paint(before);
      return { ok: false, reason: "missing" };
    }
    if (messages !== fresh.messages) {
      await client.entities.ChatSession.update(sessionId, { messages, keep_arrivals: true });
    }
    return { ok: true, reactions: after };
  } catch {
    paint(before);
    return { ok: false, reason: "error" };
  }
}
