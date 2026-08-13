// @ts-check

/** @type {Record<string, { label: string, color: string, glow: string, fill: string }>} */
export const ELEMENT_THEME = {
  void: { label: "Void", color: "#67e8f9", glow: "rgba(103,232,249,0.55)", fill: "rgba(34,211,238,0.12)" },
  ember: { label: "Ember", color: "#fb923c", glow: "rgba(251,146,60,0.55)", fill: "rgba(251,146,60,0.12)" },
  tide: { label: "Tide", color: "#60a5fa", glow: "rgba(96,165,250,0.55)", fill: "rgba(96,165,250,0.12)" },
  volt: { label: "Volt", color: "#facc15", glow: "rgba(250,204,21,0.55)", fill: "rgba(250,204,21,0.12)" },
  grove: { label: "Grove", color: "#4ade80", glow: "rgba(74,222,128,0.55)", fill: "rgba(74,222,128,0.12)" },
};

/** @type {Record<string, { label: string, color: string }>} */
export const CLASS_THEME = {
  standard: { label: "Standard", color: "#67e8f9" },
  apex: { label: "Apex", color: "#c4b5fd" },
  nova: { label: "Nova", color: "#fb7185" },
};

/** @type {Record<string, string>} */
export const TACTIC_LABEL = {
  none: "—",
  blade: "Blade",
  gale: "Gale",
  mark: "Mark",
  shatter: "Shatter",
  summon: "Summon",
  mend: "Mend",
};

/**
 * @param {string} element
 */
export function elementTheme(element) {
  return ELEMENT_THEME[element] || ELEMENT_THEME.void;
}
