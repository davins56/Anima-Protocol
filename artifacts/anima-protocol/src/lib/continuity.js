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
