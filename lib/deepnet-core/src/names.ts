/**
 * Working name. Dàvīn asked for an original name instead of "Undernet" (#757);
 * until he picks one, every id, flag, route and table uses the neutral
 * placeholder `deepnet`, and the UI shows this label. Renaming later changes
 * this constant and the flag names only.
 */
export const DEEPNET_DISPLAY_NAME = "Deepnet (working name)";

/** Bumped whenever authored content changes; stored with each quest event. */
export const DEEPNET_CONTENT_VERSION = "slice-1.placeholder";

/**
 * Names that must never appear in Deepnet content: the place is MMBN-inspired
 * in structure only. Matched case-insensitively against every content string
 * (see test/deepnetCore.test.ts).
 */
export const BANNED_FRANCHISE_TERMS: readonly string[] = [
  "megaman",
  "mega man",
  "rockman",
  "netnavi",
  "net navi",
  "battle chip",
  "battlechip",
  "mettaur",
  "lan hikari",
  "hikari",
  "den city",
  "acdc",
  "wily",
  "program advance",
  "undernet",
  "cyber city",
  "capcom",
];
