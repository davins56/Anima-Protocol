// @ts-check

/** @type {Record<string, { label: string, color: string, glow: string, fill: string }>} */
export const ECHO_ELEMENT_THEME = {
  void: { label: "Void", color: "#67e8f9", glow: "rgba(103,232,249,0.55)", fill: "rgba(34,211,238,0.12)" },
  ember: { label: "Ember", color: "#fb923c", glow: "rgba(251,146,60,0.55)", fill: "rgba(251,146,60,0.12)" },
  tide: { label: "Tide", color: "#60a5fa", glow: "rgba(96,165,250,0.55)", fill: "rgba(96,165,250,0.12)" },
  volt: { label: "Volt", color: "#facc15", glow: "rgba(250,204,21,0.55)", fill: "rgba(250,204,21,0.12)" },
  grove: { label: "Grove", color: "#4ade80", glow: "rgba(74,222,128,0.55)", fill: "rgba(74,222,128,0.12)" },
};

/** @type {Record<string, { label: string, color: string }>} */
export const ECHO_CLASS_THEME = {
  standard: { label: "Standard", color: "#67e8f9" },
  mega: { label: "Mega", color: "#c4b5fd" },
  star: { label: "Star", color: "#fde68a" },
  dark: { label: "Dark", color: "#fb7185" },
  giga: { label: "Giga", color: "#f472b6" },
};

/** @type {Record<string, string>} */
export const ECHO_ABILITY_LABEL = {
  base: "Summon",
  pierce: "Pierce",
  heavy: "Heavy",
  burn: "Burn",
  push: "Push",
  chain: "Chain",
  root: "Root",
  lockon: "Lock-On",
  multihit: "Multi-Hit",
  "echo-debt": "Echo Debt",
};

/** @type {Record<string, string>} */
export const ECHO_KIND_LABEL = {
  blast: "Blast",
  sword: "Sword",
  area: "Area",
  heal: "Mend",
  guard: "Guard",
  field: "Field",
  support: "Support",
};

/** @param {string} element */
export function echoElementTheme(element) {
  return ECHO_ELEMENT_THEME[element] || ECHO_ELEMENT_THEME.void;
}
