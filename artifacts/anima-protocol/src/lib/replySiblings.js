// Chat upgrade 2: sibling regenerates on a message tree.
//
// Behind VITE_ANIMA_REPLY_SIBLINGS=1 (off by default). With the flag off none
// of this runs and Retry keeps discarding the old reply, as before.
//
// Tree model (no migration): a user line is a tree node. Its children are the
// replies written for it. The live child is the ordinary run of rows after the
// user line. Earlier children are archived on that user line's row as
// `reply_siblings`, a capped JSON list that rides along in the existing
// ChatMessage row data (POST /messages/replace already stores extra fields).
//
// Each archived sibling is the whole branch that Retry discarded: her reply
// plus anything that came after it, so going back to an earlier reply also
// brings back the conversation that followed it.

/** Build-time flag. "1", "true" or "on" turn it on; anything else is off. */
export function replySiblingsEnabled(env = import.meta.env) {
  const raw = String(env?.VITE_ANIMA_REPLY_SIBLINGS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export const MAX_SIBLINGS = 8;
export const MAX_BRANCH_MESSAGES = 24;
export const MAX_SIBLING_CHARS = 16_000;

const KEEP_FIELDS = ["role", "content", "character_name", "type", "attachments", "created_date"];

function listOf(messages) {
  return Array.isArray(messages) ? messages : [];
}

function isPlaceholder(message) {
  const name = message?.character_name;
  return name === "__typing__" || name === "__thinking__" || message?.is_streaming === true;
}

function cleanMessage(message) {
  const out = {};
  for (const key of KEEP_FIELDS) {
    if (message[key] !== undefined && message[key] !== null) out[key] = message[key];
  }
  if (typeof out.content === "string" && out.content.length > MAX_SIBLING_CHARS) {
    out.content = out.content.slice(0, MAX_SIBLING_CHARS);
  }
  if (message.id != null) out.origin_id = String(message.id);
  return out;
}

function randomKey() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Index of the user line a reply at `start` answers, or -1. */
export function parentUserIndex(messages, start) {
  const list = listOf(messages);
  for (let i = Math.min(start, list.length) - 1; i >= 0; i -= 1) {
    if (list[i]?.role === "user") return i;
  }
  return -1;
}

/** Archived siblings on a user row (always an array). */
export function siblingsOf(message) {
  return Array.isArray(message?.reply_siblings)
    ? message.reply_siblings.filter((s) => s && Array.isArray(s.messages) && s.messages.length > 0)
    : [];
}

/** A branch as a sibling record, or null when there is nothing worth keeping. */
export function branchToSibling(branch, now = new Date().toISOString(), key = randomKey()) {
  const messages = listOf(branch)
    .filter((m) => m && !isPlaceholder(m) && m.type !== "crisis_resource" && m.type !== "ai_notice")
    .slice(0, MAX_BRANCH_MESSAGES)
    .map(cleanMessage)
    .filter((m) => typeof m.content === "string" && m.content.trim() !== "");
  if (!messages.some((m) => m.role === "assistant")) return null;
  return { key, archived_at: now, messages };
}

/**
 * Retry with the flag on: keep the discarded branch as a sibling on its user
 * line. `plan` is planRetryReply's result; `messages` is the list it was
 * planned from. Returns a new `kept` list (the user row gets the sibling), or
 * the plan's own `kept` when there is no user line or nothing to keep.
 */
export function keepRetriedBranch(messages, plan, opts = {}) {
  const list = listOf(messages);
  const kept = listOf(plan?.kept);
  if (!plan?.ok || kept.length >= list.length) return kept;
  const parent = parentUserIndex(kept, kept.length);
  if (parent < 0) return kept;
  const sibling = branchToSibling(list.slice(kept.length), opts.now, opts.key);
  if (!sibling) return kept;
  const user = kept[parent];
  const next = [...siblingsOf(user), sibling].slice(-MAX_SIBLINGS);
  const out = kept.slice();
  out[parent] = { ...user, reply_siblings: next };
  return out;
}

/**
 * Pager state for the first reply after a user line that has siblings.
 * Returns null for every other row. `total` counts the live reply, which is
 * always the last position.
 */
export function siblingPagerAt(messages, index) {
  const list = listOf(messages);
  const row = list[index];
  if (!row || row.role !== "assistant" || isPlaceholder(row)) return null;
  const prev = list[index - 1];
  if (!prev || prev.role !== "user") return null;
  const siblings = siblingsOf(prev);
  if (siblings.length === 0) return null;
  return { parentIndex: index - 1, siblings, total: siblings.length + 1 };
}

/**
 * Switch the live branch under the user line at `parentIndex` to the archived
 * sibling `key`. The live branch (that user line's replies and everything
 * after) is archived in its place, so nothing is lost. Restored rows get new
 * ids and no turn id: the old turn may be marked replaced on the server, and a
 * row tied to a replaced turn is refused by /messages/replace.
 */
export function switchToSibling(messages, parentIndex, key, opts = {}) {
  const list = listOf(messages);
  const parent = list[parentIndex];
  if (!parent || parent.role !== "user") return { ok: false, reason: "no_parent" };
  const siblings = siblingsOf(parent);
  const chosen = siblings.find((s) => s.key === key);
  if (!chosen) return { ok: false, reason: "no_sibling" };
  const live = list.slice(parentIndex + 1);
  if (live.some(isPlaceholder)) return { ok: false, reason: "busy" };
  const archivedLive = branchToSibling(live, opts.now, opts.key);
  const rest = siblings.filter((s) => s.key !== key);
  const nextSiblings = (archivedLive ? [...rest, archivedLive] : rest).slice(-MAX_SIBLINGS);
  const makeId = opts.makeId || (() => `sib_${randomKey()}`);
  const restored = chosen.messages.map((m) => {
    const { origin_id: originId, ...fields } = m;
    return { ...fields, id: makeId(), restored_from: originId || null };
  });
  const head = list.slice(0, parentIndex);
  return {
    ok: true,
    messages: [...head, { ...parent, reply_siblings: nextSiblings }, ...restored],
  };
}
