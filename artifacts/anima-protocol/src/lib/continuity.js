/** Client helpers for the continuity layer (server: /api/continuity). */

export const PRESENCE_STYLES = {
  here: { dot: "bg-emerald-400", pulse: false },
  drifting: { dot: "bg-sky-300/80", pulse: false },
  dreaming: { dot: "bg-violet-400", pulse: true },
  resting: { dot: "bg-primary/30", pulse: false },
};

export function presenceStyle(presence) {
  return PRESENCE_STYLES[presence] || PRESENCE_STYLES.resting;
}

/** Same window the server uses for "here" (continuityCore.presenceState). */
export const LIVE_PRESENCE_MINUTES = 10;

function messageTime(message) {
  const raw = message?.timestamp || message?.created_at || message?.created_date || message?.createdAt;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Newest message time in a chat (ms), or null when none carry a time. */
export function latestActivityAt(messages) {
  if (!Array.isArray(messages)) return null;
  let latest = null;
  for (const m of messages) {
    const t = messageTime(m);
    if (t != null && (latest == null || t > latest)) latest = t;
  }
  return latest;
}

/**
 * Presence the header should show. The continuity payload is loaded once
 * when the chat opens, from her last logged turn; a live conversation in
 * this chat is newer evidence and always wins, so she is never "dreaming"
 * or "resting" while you are talking with her.
 */
export function livePresence(loaded, { activeAt = null, replying = false, now = Date.now(), name = "" } = {}) {
  const live =
    replying || (activeAt != null && now - activeAt >= -60_000 && now - activeAt < LIVE_PRESENCE_MINUTES * 60_000);
  if (live) {
    const who = String(name || "").trim() || "She";
    return { presence: "here", presence_label: `${who} is here` };
  }
  if (!loaded?.presence) return null;
  return { presence: loaded.presence, presence_label: loaded.presence_label };
}

const GREETING_KEY = "anima_continuity_greeting_seen";

/** One greeting per companion per dream/gap: remember what we already showed. */
export function greetingSeen(characterId, greeting, storage = globalThis.localStorage) {
  if (!greeting?.text) return true;
  try {
    const seen = JSON.parse(storage?.getItem(GREETING_KEY) || "{}");
    return seen[characterId] === greeting.text;
  } catch {
    return false;
  }
}

export function markGreetingSeen(characterId, greeting, storage = globalThis.localStorage) {
  if (!greeting?.text) return;
  try {
    const seen = JSON.parse(storage?.getItem(GREETING_KEY) || "{}");
    seen[characterId] = greeting.text;
    storage?.setItem(GREETING_KEY, JSON.stringify(seen));
  } catch {
    /* private mode */
  }
}
