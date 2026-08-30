// @ts-check
/**
 * Map Echo Keys onto the NetBattle chip shape used by `netBattle.js`.
 */

import { ECHO_KEY_BY_ID } from "./catalog.js";
import { ELEMENT_THEME } from "../energyFragments/theme.js";

/** @type {Record<string, string>} */
const SUMMON_TO_KIND = {
  cannon: "blast",
  spreader: "blast",
  bomb: "area",
  sword: "sword",
  wave: "blast",
  tower: "area",
  quake: "area",
  fist: "blast",
  dash: "sword",
  howitzer: "area",
  arrow: "blast",
  homing: "blast",
  sheet: "area",
  gaia: "area",
  orb: "blast",
  orbit: "blast",
  gyre: "area",
  coil: "area",
  drain: "blast",
  aura: "heal",
  panel: "area",
  hammer: "sword",
  shield: "heal",
  mend: "heal",
  steal: "area",
  field: "area",
  escape: "area",
  silence: "area",
  repair: "heal",
  chrono: "area",
  rain: "area",
  mine: "area",
  seek: "blast",
  remote: "blast",
  lockon: "blast",
  wick: "area",
  idol: "area",
  cube: "area",
  buster: "blast",
  gauge: "heal",
  fade: "heal",
  wrap: "heal",
  sigil: "area",
  prism: "blast",
  gravity: "area",
  rift: "area",
};

/**
 * @param {import("./catalog.js").EchoKey} key
 * @param {string} [code]
 */
export function echoKeyToChip(key, code) {
  const kind =
    key.memory === "plus" || key.tactic === "mend" || key.summon === "mend"
      ? "heal"
      : SUMMON_TO_KIND[key.summon] || "blast";
  const theme = ELEMENT_THEME[key.element] || ELEMENT_THEME.void;
  const letter = code && key.codes.includes(code) ? code : key.codes[0];
  const damage = key.power || 0;
  return {
    id: key.id,
    name: key.name,
    code: letter,
    letter,
    kind,
    damage: kind === "heal" ? 0 : damage,
    heal: kind === "heal" ? Math.max(20, damage || 40) : 0,
    reach: key.tactic === "blade" || key.summon === "sword" ? (key.name.toLowerCase().includes("long") ? 2 : 1) : 1,
    wide: /wide|column|sheet/i.test(key.name),
    color: theme.color,
    description: key.description,
    element: key.element,
    tactic: key.tactic,
    memory: key.memory,
    echoClass: key.class,
    mb: key.mb,
    hits: key.hits,
  };
}

/**
 * @param {{ id: string, code: string }[]} folder
 */
export function chipsFromEchoFolder(folder) {
  const chips = [];
  for (const slot of folder || []) {
    const key = ECHO_KEY_BY_ID[slot.id];
    if (!key) continue;
    chips.push(echoKeyToChip(key, slot.code));
  }
  return chips;
}
