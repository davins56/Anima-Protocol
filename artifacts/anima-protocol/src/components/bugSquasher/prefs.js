// @ts-check
/** Local preference: show the slim "Bug" tab on every screen. */
export const SHOW_TAB_KEY = "anima.bugSquasher.showTab";
export const SHOW_TAB_EVENT = "anima:bug-squasher-tab";

/**
 * Admins see the tab by default; everyone else opts in from Settings.
 * @param {boolean} isAdmin
 * @returns {boolean}
 */
export function readShowTab(isAdmin) {
  try {
    const stored = window.localStorage.getItem(SHOW_TAB_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    /* storage blocked */
  }
  return isAdmin;
}

/** @param {boolean} value */
export function writeShowTab(value) {
  try {
    window.localStorage.setItem(SHOW_TAB_KEY, value ? "1" : "0");
    window.dispatchEvent(new CustomEvent(SHOW_TAB_EVENT, { detail: value }));
  } catch {
    /* storage blocked */
  }
}
