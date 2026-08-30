// @ts-check
/**
 * Echo Key library — ~800 distinct weapon-memories.
 * Built from ECHO_FAMILIES × VARIANT_SLOTS. Original Anima names only.
 */

import {
  ECHO_FAMILIES,
  VARIANT_SLOTS,
  GIGA_FAMILY_IDS,
  variantName,
} from "./families.js";

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
 */

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
export const ECHO_KEYS = numberLibrary(buildRows());

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
