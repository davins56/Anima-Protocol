// @ts-check
import { ECHO_KEYS, ECHO_KEY_BY_ID } from "./catalog.js";
import { compatibilityScore } from "./resonance.js";
import {
  FOLDER_RULES,
  ELEMENT_WEAKNESS,
  TACTIC_WEAKNESS,
  codesMatch,
  selectionIsLinked,
  elementMultiplier,
  tacticMultiplier,
} from "../energyFragments/rules.js";

export {
  FOLDER_RULES,
  ELEMENT_WEAKNESS,
  TACTIC_WEAKNESS,
  codesMatch,
  selectionIsLinked,
  elementMultiplier,
  tacticMultiplier,
};

/** Extra folder caps for Echo Key memories (Star Force / Dark / Plus). */
export const ECHO_FOLDER_RULES = {
  ...FOLDER_RULES,
  minSize: 8,
  maxDark: 1,
  maxBrother: 3,
  maxPlus: 4,
};

/** Opening Echo Shards — enough to load a Resonance Array, not the Codex. */
export const STARTER_ECHO_KEY_IDS = [
  "pulse-emitter",
  "halo-burst",
  "ember-seed",
  "high-pulse",
  "phantom-edge",
  "cinder-veil",
  "mend-50",
  "tide-halo",
];

const STARTER_IDS = STARTER_ECHO_KEY_IDS;

export function starterOwnedIds() {
  return STARTER_ECHO_KEY_IDS.filter((id) => ECHO_KEY_BY_ID[id]);
}

/**
 * @param {string} id
 * @param {string} [code]
 */
export function makeEchoCopy(id, code) {
  const key = ECHO_KEY_BY_ID[id];
  if (!key) throw new Error(`Unknown Echo Key: ${id}`);
  const chosen = code && key.codes.includes(code) ? code : key.codes[0];
  return { id: key.id, code: chosen };
}

export function starterEchoFolder() {
  return STARTER_IDS.map((id) => {
    if (ECHO_KEY_BY_ID[id]) return makeEchoCopy(id);
    const fallback = ECHO_KEYS.find((k) => k.class === "standard" && (k.power || 0) > 0);
    return makeEchoCopy(fallback.id);
  });
}

/**
 * @param {{ id: string, code: string }[]} folder
 */
export function validateEchoFolder(folder) {
  /** @type {string[]} */
  const errors = [];
  if (folder.length < ECHO_FOLDER_RULES.minSize) {
    errors.push(
      `Resonance Array needs at least ${ECHO_FOLDER_RULES.minSize} Keys (has ${folder.length}).`,
    );
  }
  if (folder.length > ECHO_FOLDER_RULES.size) {
    errors.push(`Resonance Array holds at most ${ECHO_FOLDER_RULES.size} Keys (has ${folder.length}).`);
  }
  /** @type {Record<string, number>} */
  const copies = {};
  let apex = 0;
  let nova = 0;
  let dark = 0;
  let brother = 0;
  let plus = 0;
  for (const slot of folder) {
    const key = ECHO_KEY_BY_ID[slot.id];
    if (!key) {
      errors.push(`Unknown Echo Key ${slot.id}.`);
      continue;
    }
    if (!key.codes.includes(slot.code)) {
      errors.push(`${key.name} has no code ${slot.code}.`);
    }
    copies[slot.id] = (copies[slot.id] || 0) + 1;
    if (key.class === "apex") apex += 1;
    if (key.class === "nova") nova += 1;
    if (key.memory === "dark") dark += 1;
    if (key.memory === "brother") brother += 1;
    if (key.memory === "plus") plus += 1;
  }
  for (const [id, n] of Object.entries(copies)) {
    const key = ECHO_KEY_BY_ID[id];
    if (!key) continue;
    if (key.class === "standard" && n > ECHO_FOLDER_RULES.maxCopiesStandard) {
      errors.push(`${key.name}: max ${ECHO_FOLDER_RULES.maxCopiesStandard} copies.`);
    }
    if (key.class === "apex" && n > ECHO_FOLDER_RULES.maxCopiesApex) {
      errors.push(`${key.name}: Apex copies capped at ${ECHO_FOLDER_RULES.maxCopiesApex}.`);
    }
    if (key.class === "nova" && n > 1) {
      errors.push(`${key.name}: Nova copies capped at 1.`);
    }
  }
  if (apex > ECHO_FOLDER_RULES.maxApex) errors.push(`Max ${ECHO_FOLDER_RULES.maxApex} Apex keys.`);
  if (nova > ECHO_FOLDER_RULES.maxNova) errors.push(`Max ${ECHO_FOLDER_RULES.maxNova} Nova key.`);
  if (dark > ECHO_FOLDER_RULES.maxDark) errors.push(`Max ${ECHO_FOLDER_RULES.maxDark} Dark memory.`);
  if (brother > ECHO_FOLDER_RULES.maxBrother) {
    errors.push(`Max ${ECHO_FOLDER_RULES.maxBrother} Brother-band memories.`);
  }
  if (plus > ECHO_FOLDER_RULES.maxPlus) errors.push(`Max ${ECHO_FOLDER_RULES.maxPlus} Plus memories.`);
  return { ok: errors.length === 0, errors };
}

/**
 * @param {{ id: string, code: string }[]} folder
 * @param {number} n
 * @param {() => number} [rng]
 */
export function drawEchoHand(folder, n = 5, rng = Math.random) {
  const pool = [...folder];
  /** @type {{ id: string, code: string }[]} */
  const hand = [];
  while (hand.length < n && pool.length) {
    const i = Math.floor(rng() * pool.length);
    hand.push(pool.splice(i, 1)[0]);
  }
  return hand;
}

/**
 * Resonance Draw — same as a folder draw, but Keys that match the Anima's
 * expression are more likely to surface.
 *
 * @param {{ id: string, code: string }[]} folder
 * @param {Record<string, number> | null | undefined} spectrum
 * @param {number} [n]
 * @param {() => number} [rng]
 */
export function drawResonanceHand(folder, spectrum, n = 5, rng = Math.random) {
  if (!spectrum) return drawEchoHand(folder, n, rng);
  const pool = [...folder];
  /** @type {{ id: string, code: string }[]} */
  const hand = [];
  while (hand.length < n && pool.length) {
    const weights = pool.map((slot) => {
      const key = ECHO_KEY_BY_ID[slot.id];
      return key ? compatibilityScore(key, spectrum) : 0.5;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    let picked = 0;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) {
        picked = i;
        break;
      }
    }
    hand.push(pool.splice(picked, 1)[0]);
  }
  return hand;
}
