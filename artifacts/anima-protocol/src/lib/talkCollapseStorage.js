// @ts-check

/** localStorage prefix for Talk-screen section collapse, keyed per user. */
export const TALK_COLLAPSE_PREFIX = "anima:talk:collapse";

/** Used when no Clerk (or app) user id is available. */
export const TALK_COLLAPSE_ANON_ID = "anon";

export const TALK_COLLAPSE_SECTIONS = Object.freeze(["header", "resonance"]);

/**
 * @param {unknown} userId
 * @returns {string}
 */
export function talkCollapseUserId(userId) {
  if (userId == null) return TALK_COLLAPSE_ANON_ID;
  const id = String(userId).trim();
  return id || TALK_COLLAPSE_ANON_ID;
}

/**
 * @param {unknown} userId
 * @param {string} section
 * @returns {string}
 */
export function talkCollapseStorageKey(userId, section) {
  return `${TALK_COLLAPSE_PREFIX}:${talkCollapseUserId(userId)}:${section}`;
}

/**
 * @param {unknown} userId
 * @param {string} section
 * @returns {boolean}
 */
export function readTalkCollapsed(userId, section) {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(talkCollapseStorageKey(userId, section));
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

/**
 * @param {unknown} userId
 * @param {string} section
 * @param {boolean} collapsed
 */
export function writeTalkCollapsed(userId, section, collapsed) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(talkCollapseStorageKey(userId, section), collapsed ? "1" : "0");
  } catch {
    // Quota or private-mode denial — collapse still works for this session.
  }
}
