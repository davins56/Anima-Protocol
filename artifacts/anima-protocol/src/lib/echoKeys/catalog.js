// @ts-check
/**
 * Echo Key Codex — ~800 family memories plus a handful of featured
 * resonance artifacts. Built from ECHO_FAMILIES × VARIANT_SLOTS.
 * Operators find, synthesise, or evolve keys in story mode; the Codex
 * is not granted on day one. Original Anima names only.
 */

import {
  ECHO_FAMILIES,
  VARIANT_SLOTS,
  GIGA_FAMILY_IDS,
  variantName,
} from "./families.js";
import { CANON_ECHO_KEYS } from "./canon.js";

/** @typedef {"standard"|"mega"|"star"|"dark"|"giga"} EchoClass */
/** @typedef {"void"|"ember"|"tide"|"volt"|"grove"} EchoElement */

/**
 * @typedef {object} EchoAbility
 * @property {string} tag
 * @property {number} hits
 * @property {number} [heal]
 * @property {number} [reach]
 * @property {boolean} [wide]
 * @property {boolean} [pierce]
 * @property {string} [panel]
 */

/**
 * @typedef {object} EchoKey
 * @property {string} id
 * @property {string} name
 * @property {number} libraryNo
 * @property {string} family
 * @property {EchoClass} class
 * @property {EchoElement} element
 * @property {import("./families.js").EchoTactic} tactic
 * @property {import("./families.js").EchoKind} kind
 * @property {number} power
 * @property {number} mb
 * @property {string[]} codes
 * @property {string} description
 * @property {string} memory
 * @property {import("./families.js").EchoSummon} summon
 * @property {string} inspiredBy
 * @property {string[]} sources
 * @property {EchoAbility} ability
 * @property {import("./resonance.js").EchoTier} [tier]
 * @property {string} [originSite]
 * @property {string} [memoryText]
 */

/**
 * Story-mode featured Keys. Not shop goods; not Fallen Circuit Prime Keys.
 */
export const FEATURED_RESONANCE_KEYS = [
  {
    id: "last-ember",
    name: "Last Ember",
    family: "featured",
    class: "standard",
    element: "ember",
    tactic: "none",
    kind: "area",
    power: 90,
    mb: 18,
    codes: ["L", "E", "*"],
    description:
      "Final surviving flame of a destroyed settlement. Invokes three resonance flames. Passive: output rises when the Anima's integrity falls below 30%.",
    memory: "Remembers the last hearth of a settlement that ended in one night.",
    summon: "bomb",
    inspiredBy: "bomb",
    sources: ["story"],
    ability: { tag: "burst", hits: 3 },
    originSite: "fallen-ruin",
    memoryText: "The last hearth of a settlement that ended in one night. The flame refused to forget its purpose.",
  },
  {
    id: "ember-that-refused",
    name: "Ember That Refused",
    family: "featured",
    class: "mega",
    element: "ember",
    tactic: "none",
    kind: "area",
    power: 160,
    mb: 28,
    codes: ["L", "R", "*"],
    description: "Last Ember after it reinterpreted survival as defiance. Four flames, and a refusal to go out.",
    memory: "Remembers the event developing a new interpretation.",
    summon: "bomb",
    inspiredBy: "bomb",
    sources: ["story"],
    ability: { tag: "burst", hits: 4 },
    originSite: "fallen-ruin",
    memoryText: "Not the last flame — the flame that would not end.",
  },
  {
    id: "pyre-key",
    name: "Pyre Key",
    family: "featured",
    class: "standard",
    element: "ember",
    tactic: "none",
    kind: "area",
    power: 70,
    mb: 14,
    codes: ["P", "Y", "*"],
    description: "A pyric instruction. Heat that still knows the shape of a funeral or a forge.",
    memory: "Remembers coherent fire — grief or craft.",
    summon: "wick",
    inspiredBy: "bomb",
    sources: ["story"],
    ability: { tag: "burst", hits: 1 },
    originSite: "old-battlefield",
    memoryText: "Coherent fire — grief or craft, the Lattice does not moralize.",
  },
  {
    id: "gale-key",
    name: "Gale Key",
    family: "featured",
    class: "standard",
    element: "tide",
    tactic: "gale",
    kind: "blast",
    power: 55,
    mb: 12,
    codes: ["G", "A", "*"],
    description: "Wind given a job. Opens space, carries another Key's output, or strips a veil.",
    memory: "Remembers air over moving water.",
    summon: "wave",
    inspiredBy: "airshot",
    sources: ["story"],
    ability: { tag: "push", hits: 1 },
    originSite: "living-water",
    memoryText: "Air over moving water. A repeating rhythm that learned how to push.",
  },
  {
    id: "firestorm",
    name: "Firestorm",
    family: "featured",
    class: "mega",
    element: "ember",
    tactic: "gale",
    kind: "area",
    power: 140,
    mb: 32,
    codes: ["F", "S"],
    description: "Pyre Key braided with Gale Key. Heat given weather.",
    memory: "Remembers an Echo Sequence: fire that learned the grammar of wind.",
    summon: "gyre",
    inspiredBy: "wind",
    sources: ["story"],
    ability: { tag: "storm", hits: 3, wide: true },
    originSite: "old-battlefield",
    memoryText: "An Echo Sequence: fire that learned the grammar of wind.",
  },
  {
    id: "grief-echo",
    name: "Grief Echo",
    family: "featured",
    class: "standard",
    element: "void",
    tactic: "mark",
    kind: "field",
    power: 40,
    mb: 16,
    codes: ["G", "R", "*"],
    description: "A memory of loss coherent enough to execute. Disrupts another Anima's frequency.",
    memory: "Remembers thousands of minds meeting the same absence.",
    summon: "silence",
    inspiredBy: "dark",
    sources: ["story"],
    ability: { tag: "disrupt", hits: 1 },
    originSite: "quiet-yard",
    memoryText: "Thousands of minds meeting the same absence. The Lattice kept the chord.",
  },
  {
    id: "memory-echo",
    name: "Memory Echo",
    family: "featured",
    class: "standard",
    element: "void",
    tactic: "summon",
    kind: "support",
    power: 0,
    mb: 20,
    codes: ["M", "E", "*"],
    description: "Replays a fragment of a historical Echo. Temporarily modifies the Anima's configuration.",
    memory: "Remembers a place where people kept telling the same story until the story learned to stand.",
    summon: "sigil",
    inspiredBy: "plus",
    sources: ["story"],
    ability: { tag: "recall", hits: 0 },
    originSite: "sacred-place",
    memoryText: "A place where people kept telling the same story until the story learned to stand.",
  },
  {
    id: "veil-key",
    name: "Veil Key",
    family: "featured",
    class: "standard",
    element: "grove",
    tactic: "none",
    kind: "guard",
    power: 0,
    mb: 14,
    codes: ["V", "L", "*"],
    description: "A shielding harmonic. Softens incoming frequency; can hide a path.",
    memory: "Remembers intention and leaf-light held in the same tempo.",
    summon: "aura",
    inspiredBy: "barrier",
    sources: ["story"],
    ability: { tag: "veil", hits: 0, heal: 20 },
    originSite: "sanctuary-garden",
    memoryText: "Intention and leaf-light held in the same tempo long enough to thicken.",
  },
  {
    id: "mourning-gate",
    name: "Mourning Gate",
    family: "featured",
    class: "mega",
    element: "void",
    tactic: "summon",
    kind: "field",
    power: 0,
    mb: 44,
    codes: ["M", "G"],
    description:
      "Grief Echo + Memory Echo + Veil Key. Opens a traversal pathway through remembered loss — a door, not a wound.",
    memory: "Remembers three memories of absence agreeing on a shape.",
    summon: "rift",
    inspiredBy: "secret",
    sources: ["story"],
    ability: { tag: "gate", hits: 0 },
    originSite: "quiet-yard",
    memoryText: "Three memories of absence agreed on a shape. The Lattice called it a gate.",
  },
];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const ABILITY_BLURB = {
  base: "Standard summon of this remembered weapon.",
  pierce: "The construct continues through the first body.",
  heavy: "A cathedral-weight version of the same memory.",
  burn: "Ember-aspected. Leaves the landing panel burning.",
  push: "Tide-aspected. Shoves the target one panel.",
  chain: "Volt-aspected. Leaps to a second body on the same row.",
  root: "Grove-aspected. Roots the hit panel in grass-light.",
  lockon: "Star Force memory — locks the far panel before it fires.",
  multihit: "Noise-remixed. The same memory hits five fading times.",
  "echo-debt": "Dark echo. Power swells with HP already spent this fight.",
};

const KIND_REACH = {
  sword: 1,
  blast: 0,
  area: 0,
  heal: 0,
  guard: 0,
  field: 0,
  support: 0,
};

/**
 * @param {string} familyId
 * @param {number} slotIndex
 */
function codesFor(familyId, slotIndex) {
  const seed = familyId.split("").reduce((n, ch) => n + ch.charCodeAt(0), slotIndex * 17);
  const a = LETTERS[seed % 26];
  const b = LETTERS[(seed + 7) % 26];
  const c = LETTERS[(seed + 13) % 26];
  const set = [...new Set([a, b, c])];
  if (slotIndex === 0 || slotIndex === 7) set.push("*");
  return set;
}

/**
 * @param {import("./families.js").EchoFamilyDef} family
 * @param {(typeof VARIANT_SLOTS)[number]} slot
 * @param {number} slotIndex
 */
function abilityFor(family, slot, slotIndex) {
  /** @type {EchoAbility} */
  const ability = {
    tag: slot.ability,
    hits: slot.hits,
    pierce: slot.ability === "pierce" || slot.ability === "lockon",
    wide: family.kind === "sword" && (slotIndex === 1 || family.id === "phantom" && slot.id === "high"),
    reach: family.kind === "sword" ? (slotIndex === 2 || family.id === "stepcut" ? 2 : KIND_REACH.sword) : undefined,
  };
  if (family.kind === "heal") {
    const heals = [30, 50, 80, 50, 50, 50, 50, 120, 80, 200];
    ability.heal = heals[slotIndex];
  }
  if (family.kind === "guard") {
    ability.heal = slotIndex === 9 ? 40 : 10;
  }
  if (slot.ability === "burn") ability.panel = "lava";
  if (slot.ability === "push") ability.panel = "ice";
  if (slot.ability === "root") ability.panel = "grass";
  if (family.kind === "sword" && slot.id === "high") ability.wide = true;
  if (family.kind === "sword" && slot.id === "apex") ability.reach = 2;
  return ability;
}

/**
 * @param {import("./families.js").EchoFamilyDef} family
 * @param {(typeof VARIANT_SLOTS)[number]} slot
 */
function powerFor(family, slot) {
  if (family.kind === "heal") return null;
  if (family.kind === "guard" || family.kind === "support" || family.kind === "field") {
    if (family.basePower === 0) return null;
  }
  if (slot.ability === "echo-debt" && family.id === "debt") return null;
  return Math.max(0, Math.round(family.basePower * slot.powerMul));
}

/**
 * @param {import("./families.js").EchoFamilyDef} family
 * @param {(typeof VARIANT_SLOTS)[number]} slot
 */
function classFor(family, slot) {
  if (slot.id === "shade" && GIGA_FAMILY_IDS.includes(family.id)) return "giga";
  return slot.class;
}

/**
 * @param {import("./families.js").EchoFamilyDef} family
 * @param {(typeof VARIANT_SLOTS)[number]} slot
 */
function elementFor(family, slot) {
  if (family.id === "lavaspout" && slot.id === "base") return "ember";
  if (family.id === "heatshot" && slot.id === "base") return "ember";
  if (family.id === "heatupper" && slot.id === "base") return "ember";
  if (family.id === "crossheat" && slot.id === "base") return "ember";
  if (family.id === "woodpowder" && slot.id === "base") return "grove";
  if (family.id === "elecreel" && slot.id === "base") return "volt";
  if (family.id === "spark" && slot.id === "base") return "volt";
  if (family.id === "plasmagun" && slot.id === "base") return "volt";
  if (family.id === "iceneedle" && slot.id === "base") return "tide";
  if (family.id === "rainveil" && slot.id === "base") return "tide";
  return /** @type {EchoElement} */ (slot.elementFrom);
}

/**
 * @param {Omit<EchoKey, "libraryNo">[]} rows
 * @returns {EchoKey[]}
 */
function numberLibrary(rows) {
  return rows.map((row, i) => ({ ...row, libraryNo: i + 1 }));
}

/** @returns {Omit<EchoKey, "libraryNo">[]} */
function buildRows() {
  /** @type {Omit<EchoKey, "libraryNo">[]} */
  const rows = [];
  for (const family of ECHO_FAMILIES) {
    VARIANT_SLOTS.forEach((slot, slotIndex) => {
      const name = variantName(family, slotIndex);
      const klass = classFor(family, slot);
      const element = elementFor(family, slot);
      const ability = abilityFor(family, slot, slotIndex);
      const power = powerFor(family, slot);
      const mb = family.kind === "heal" ? 5 + slotIndex * 4 : slot.mb;
      rows.push({
        id: `${family.id}-${slot.id}`,
        name,
        family: family.id,
        class: klass,
        element,
        tactic: family.tactic,
        kind: family.kind,
        power,
        mb,
        codes: codesFor(family.id, slotIndex),
        description: `${family.memory} ${ABILITY_BLURB[slot.ability]}`,
        memory: family.memory,
        summon: family.summon,
        inspiredBy: family.inspiredBy,
        sources: family.sources,
        ability,
      });
    });
  }
  return rows;
}

/** @type {EchoKey[]} */
export const ECHO_KEYS = numberLibrary([
  ...buildRows(),
  ...FEATURED_RESONANCE_KEYS,
  ...CANON_ECHO_KEYS,
]);

export const ECHO_LIBRARY_SIZE = ECHO_KEYS.length;
export const ECHO_KEY_LIBRARY_SIZE = ECHO_LIBRARY_SIZE;

/** @type {Record<string, EchoKey>} */
export const ECHO_KEY_BY_ID = Object.fromEntries(ECHO_KEYS.map((k) => [k.id, k]));

/** @param {string} id */
export function getEchoKey(id) {
  return ECHO_KEY_BY_ID[id] || null;
}

/** @param {string} family */
export function echoKeysByFamily(family) {
  return ECHO_KEYS.filter((k) => k.family === family);
}

/** @param {EchoClass} klass */
export function echoKeysByClass(klass) {
  return ECHO_KEYS.filter((k) => k.class === klass);
}

export function allEchoKeyIds() {
  return ECHO_KEYS.map((k) => k.id);
}

export function coveredInspiredBy() {
  return [...new Set(ECHO_KEYS.map((k) => k.inspiredBy))];
}
