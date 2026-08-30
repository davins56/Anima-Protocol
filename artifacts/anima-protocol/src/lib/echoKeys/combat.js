// @ts-check
/**
 * Adapt Echo Keys into the NetBattle chip shape the arena already fires.
 */

import { ECHO_KEY_BY_ID } from "./catalog.js";
import { echoElementTheme } from "./theme.js";
import { findBestLink, findEchoResonance, makeEchoCopy } from "./rules.js";

const KIND_MAP = {
  blast: "blast",
  sword: "sword",
  area: "area",
  heal: "heal",
  guard: "heal",
  field: "area",
  support: "heal",
};

/**
 * @param {import("./catalog.js").EchoKey} key
 * @param {string} [code]
 */
export function echoKeyToChip(key, code) {
  const kind = KIND_MAP[key.kind] || "blast";
  const theme = echoElementTheme(key.element);
  const chosen = code && key.codes.includes(code) ? code : key.codes[0];
  const heal =
    key.ability?.heal ??
    (kind === "heal" && key.kind === "heal" ? key.power || 30 : key.kind === "guard" ? 10 : undefined);
  return {
    id: key.id,
    name: key.name,
    code: chosen,
    letter: chosen,
    kind,
    damage: key.power || 0,
    heal: kind === "heal" ? heal || 10 : undefined,
    reach: key.ability?.reach || (kind === "sword" ? 1 : undefined),
    wide: Boolean(key.ability?.wide),
    color: theme.color,
    description: key.description,
    expression: key.element,
    echoKey: true,
    family: key.family,
    echoClass: key.class,
    ability: key.ability?.tag,
    hits: key.ability?.hits || 1,
  };
}

/**
 * @param {{ id: string, code: string }} slot
 */
export function echoCopyToChip(slot) {
  const key = ECHO_KEY_BY_ID[slot.id];
  if (!key) return null;
  return echoKeyToChip(key, slot.code);
}

/**
 * Build the playable folder chips, pinning Regular (BN3+) at the front
 * and a Star-Force card as an extra opening lock-on when present.
 * @param {{ folder: { id: string, code: string }[], regular_id?: string | null, star_card_id?: string | null }} library
 */
export function echoFolderToChips(library) {
  const chips = (library.folder || []).map(echoCopyToChip).filter(Boolean);
  if (library.regular_id && ECHO_KEY_BY_ID[library.regular_id]) {
    const regular = echoKeyToChip(ECHO_KEY_BY_ID[library.regular_id]);
    const already = chips.some((c) => c.id === regular.id);
    if (!already) chips.unshift(regular);
    else {
      const at = chips.findIndex((c) => c.id === regular.id);
      if (at > 0) {
        const [pinned] = chips.splice(at, 1);
        chips.unshift(pinned);
      }
    }
  }
  if (library.star_card_id && ECHO_KEY_BY_ID[library.star_card_id]) {
    const star = echoKeyToChip(ECHO_KEY_BY_ID[library.star_card_id]);
    if (!chips.some((c) => c.id === star.id)) chips.push(star);
  }
  return chips;
}

/**
 * Adapt a folder for NetBattle. Accepts already-built chips, raw {id,code}
 * slots, a #279-style {slots} folder, or this PR's library object.
 * @param {unknown} folder
 */
export function chipsFromEchoFolder(folder) {
  if (!folder) return [];
  if (Array.isArray(folder)) {
    if (folder.length && folder[0]?.kind) return folder.filter((chip) => chip && chip.kind);
    return folder.map((slot) => {
      if (!slot) return null;
      if (slot.kind) return slot;
      return echoCopyToChip({ id: slot.id, code: slot.code });
    }).filter(Boolean);
  }
  if (typeof folder === "object" && Array.isArray(folder.slots)) {
    return folder.slots
      .map((slot) => echoCopyToChip({ id: slot.id, code: slot.code }))
      .filter(Boolean);
  }
  if (typeof folder === "object" && Array.isArray(folder.folder)) {
    return echoFolderToChips(folder);
  }
  return [];
}

/**
 * If the selected Custom IDs form a resonance or Best Link, return a fused chip.
 * @param {string[]} selectedIds
 */
export function echoResonanceChip(selectedIds) {
  const recipe = findEchoResonance(selectedIds) || findBestLink(selectedIds);
  if (!recipe) return null;
  return {
    id: recipe.id,
    name: recipe.name,
    code: "*",
    letter: "*",
    kind: recipe.kind === "heal" ? "heal" : recipe.kind === "sword" ? "sword" : recipe.kind === "blast" ? "blast" : "area",
    damage: recipe.power,
    heal: recipe.kind === "heal" ? recipe.power : undefined,
    color: "#fde68a",
    description: recipe.description,
    expression: "void",
    echoKey: true,
    ability: "best-link",
    hits: 1,
  };
}

export { makeEchoCopy };
