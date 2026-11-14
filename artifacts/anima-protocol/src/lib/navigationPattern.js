// @ts-check
/**
 * Appearance Studio → Navigation. The setting (PRESET_FIELDS.navigation in
 * experiencePresets.js) offers three mechanics, all over the same
 * destinations as the five-tab dock (Talk, People, World → Explore, You,
 * Moments) and the Explore catalogue (incl. Settings):
 *
 *   tabs    — floating five-tab dock at the bottom (default).
 *   rail    — vertical side rail on wide screens (iPad portrait 820px and
 *             up, iPad landscape, desktop). Phones are too narrow for a rail
 *             plus content, so below NAV_RAIL_MIN_WIDTH it falls back to tabs.
 *   command — compact floating command bar plus a searchable command
 *             palette (also ⌘K / Ctrl+K) that jumps to any destination.
 *
 * Presentation only; never used for authorization.
 */

export const NAV_PATTERNS = /** @type {const} */ (["tabs", "rail", "command"]);
export const NAV_RAIL_MIN_WIDTH = 768;
export const NAV_RAIL_MEDIA = `(min-width: ${NAV_RAIL_MIN_WIDTH}px)`;
/** Rail width before the left safe-area inset. */
export const NAV_RAIL_WIDTH = "76px";

/**
 * @param {unknown} value
 * @returns {"tabs" | "rail" | "command"}
 */
export function normalizeNavPattern(value) {
  return NAV_PATTERNS.includes(/** @type {any} */ (value))
    ? /** @type {"tabs" | "rail" | "command"} */ (value)
    : "tabs";
}

/**
 * The mechanic actually painted for a setting at a viewport width.
 * @param {unknown} setting
 * @param {{ wide?: boolean }} [opts]
 * @returns {"tabs" | "rail" | "command"}
 */
export function effectiveNavPattern(setting, { wide = false } = {}) {
  const pattern = normalizeNavPattern(setting);
  if (pattern === "rail" && !wide) return "tabs";
  return pattern;
}

/**
 * Read the applied setting from `<html data-experience-navigation>`.
 * @param {Document | undefined} [doc]
 */
export function readNavPatternSetting(doc = globalThis.document) {
  return normalizeNavPattern(doc?.documentElement?.dataset?.experienceNavigation);
}

/**
 * @typedef {{ id: string, label: string, path?: string, opensExplore?: boolean, icon?: string, kind: "tab" | "module" }} CommandEntry
 */

/**
 * Command palette entries: dock destinations first, then Explore modules
 * (already steward-filtered by the caller). Sign Out stays in Explore only.
 *
 * @param {{ id: string, label: string, path?: string, opensExplore?: boolean }[]} tabs
 * @param {{ label: string, path: string, icon?: string, signOut?: boolean }[]} modules
 * @param {string} [query]
 * @returns {CommandEntry[]}
 */
export function commandEntries(tabs, modules, query = "") {
  /** @type {CommandEntry[]} */
  const entries = [
    ...tabs.map((t) => ({ ...t, kind: /** @type {const} */ ("tab") })),
    ...modules
      .filter((m) => !m.signOut)
      .map((m) => ({ id: `module:${m.path}`, label: m.label, path: m.path, icon: m.icon, kind: /** @type {const} */ ("module") })),
  ];
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.label.toLowerCase().includes(q));
}
