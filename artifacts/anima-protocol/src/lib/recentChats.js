// Helpers for the Recent Chats list. Session metadata comes from
// ChatSession.list(..., { withMessages: false }) — last_message / title live
// on the row, so we never hydrate full histories just to browse.

export const RECENT_CHATS_LIMIT = 8;

export function relativeChatTime(dateStr, now = Date.now()) {
  if (!dateStr) return "";
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function cleanPreview(raw) {
  return String(raw || "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function usableMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.type === "event") return false;
  const name = message.character_name;
  if (name === "__typing__" || name === "__thinking__") return false;
  return Boolean(String(message.content || "").trim());
}

/** Last-message preview from session metadata, then hydrated messages if present. */
export function sessionPreview(session) {
  const fromField = cleanPreview(session?.last_message);
  if (fromField) return fromField;
  const msgs = Array.isArray(session?.messages) ? session.messages : [];
  const last = [...msgs].reverse().find(usableMessage);
  return cleanPreview(last?.content);
}

function rosterById(characters) {
  const map = new Map();
  for (const row of Array.isArray(characters) ? characters : []) {
    if (row?.id) map.set(row.id, row);
  }
  return map;
}

/**
 * Companion label + avatar for a session row. Solo uses character_id / title;
 * group uses title or the first roster member.
 */
export function sessionCompanion(session, characters = []) {
  const roster = rosterById(characters);
  const isGroup = session?.mode === "group";
  if (isGroup) {
    const ids = Array.isArray(session?.group_character_ids)
      ? session.group_character_ids
      : [];
    const members = ids.map((id) => roster.get(id)).filter(Boolean);
    const name =
      session?.title ||
      (members.length
        ? members
            .map((m) => m.name)
            .filter(Boolean)
            .join(", ")
        : "Group");
    return {
      name,
      avatarUrl: members[0]?.avatar_url || null,
      isGroup: true,
    };
  }

  const char =
    roster.get(session?.character_id) ||
    [...roster.values()].find((row) => row.name && row.name === session?.title) ||
    null;
  return {
    name:
      char?.name ||
      session?.character_name ||
      session?.title ||
      "Conversation",
    avatarUrl: char?.avatar_url || null,
    isGroup: false,
  };
}

export function sortRecentSessions(sessions, limit = RECENT_CHATS_LIMIT) {
  const cap = Number.isFinite(limit) && limit > 0 ? limit : RECENT_CHATS_LIMIT;
  return [...(sessions || [])]
    .filter((session) => session && typeof session.id === "string" && session.id)
    .sort((a, b) => {
      const bTime = new Date(b.updated_date || b.created_date || 0).getTime();
      const aTime = new Date(a.updated_date || a.created_date || 0).getTime();
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    })
    .slice(0, cap);
}

export function sessionHref(session) {
  const id = session?.id;
  if (typeof id !== "string" || !id.trim() || id === "undefined" || id === "null") {
    return null;
  }
  return `/chat/${id}`;
}
