// @ts-check
/**
 * Resonance metadata for Echo Keys.
 *
 * Echo Keys are crystallized memories of function — not Battle Chips.
 * Combat is one possible execution. The same artifact can shield, open a
 * path, replay a historical Echo, or temporarily rewrite an Anima.
 */

import { dominantExpression } from "../animaExpressions.js";

/** @typedef {"shard" | "key" | "sovereign" | "prime"} EchoTier */
/** @typedef {"pyric" | "aqueous" | "voltaic" | "verdant" | "umbral"} EchoFrequency */
/** @typedef {"combat" | "support" | "veil" | "memory" | "field" | "traversal" | "disrupt"} EchoRole */

export const ECHO_TIERS = /** @type {const} */ (["shard", "key", "sovereign", "prime"]);

export const FREQUENCY_FROM_ELEMENT = {
  ember: "pyric",
  tide: "aqueous",
  volt: "voltaic",
  grove: "verdant",
  void: "umbral",
};

export const FREQUENCY_LABEL = {
  pyric: "Pyric",
  aqueous: "Aqueous",
  voltaic: "Voltaic",
  verdant: "Verdant",
  umbral: "Umbral",
};

export const TIER_LABEL = {
  shard: "Echo Shard",
  key: "Echo Key",
  sovereign: "Sovereign Key",
  prime: "Prime Key",
};

export const TIER_BLURB = {
  shard: "Common crystallized instruction — the everyday language of resonance.",
  key: "A rare, sophisticated resonance program. Experiences that learned how to become programs.",
  sovereign: "Civilization-scale artifacts. Not sold. Not starter loot.",
  prime: "Lattice-level entities. The novels keep their gravity; the app only names them.",
};

const SITE_BY_ELEMENT = {
  ember: "fallen-ruin",
  tide: "living-water",
  volt: "celestial-sky",
  grove: "ancient-forest",
  void: "sacred-place",
};

const SITE_BY_MEMORY = {
  weapon: "ancient-forest",
  plus: "human-bond",
  field: "sanctuary-garden",
  dark: "old-battlefield",
  wave: "celestial-sky",
  brother: "human-bond",
  nova: "celestial-sky",
};

/** Featured keys whose remembered event can develop a new interpretation. */
export const ECHO_EVOLUTIONS = {
  "last-ember": {
    into: "ember-that-refused",
    battlesBelowCritical: 3,
    integrityThreshold: 0.3,
    label: "Survive three battles below 30% integrity",
  },
};

/**
 * @param {import("./catalog.js").EchoKey} key
 * @returns {EchoFrequency}
 */
export function frequencyOf(key) {
  return FREQUENCY_FROM_ELEMENT[key.element] || "umbral";
}

/**
 * @param {import("./catalog.js").EchoKey} key
 * @returns {EchoRole}
 */
export function roleOf(key) {
  if (key.id === "mourning-gate" || key.memory === "plus") return "memory";
  if (key.memory === "field" || key.summon === "panel" || key.summon === "field") return "field";
  if (key.tactic === "mend" || key.summon === "mend" || key.summon === "repair") return "support";
  if (key.summon === "aura" || key.summon === "shield" || key.summon === "fade" || key.summon === "wrap") {
    return "veil";
  }
  if (key.summon === "escape" || key.summon === "rift" || key.family === "aethersail") return "traversal";
  if (key.memory === "dark" || key.tactic === "mark" || key.summon === "silence" || key.summon === "steal") {
    return "disrupt";
  }
  return "combat";
}

/**
 * @param {import("./catalog.js").EchoKey} key
 * @returns {EchoTier}
 */
export function tierOf(key) {
  if (key.id === "ember-that-refused" || key.id === "firestorm" || key.id === "mourning-gate") {
    return "key";
  }
  if (key.id === "last-ember" || key.family === "featured") return "key";
  if (key.class === "nova" || key.memory === "nova") return "prime";
  if (key.class === "apex" || key.memory === "dark") return "sovereign";
  if (key.family === "energy-fragment" || key.era === "bn1") return "shard";
  const no = key.libraryNo || 0;
  if (no > 0 && no <= 160) return "shard";
  return "key";
}

/**
 * @param {import("./catalog.js").EchoKey} key
 * @returns {string[]}
 */
export function affinityOf(key) {
  if (key.memory === "dark") return ["demonic", "descended"];
  if (key.tactic === "mend" || key.memory === "brother") return ["angelic", "ascended"];
  const freq = frequencyOf(key);
  if (freq === "pyric") return ["demonic", "descended"];
  if (freq === "aqueous") return ["angelic", "ascended"];
  if (freq === "voltaic") return ["ascended", "neutral"];
  if (freq === "verdant") return ["angelic", "neutral"];
  return ["neutral", "ascended"];
}

/**
 * @param {import("./catalog.js").EchoKey} key
 */
export function rarityOf(key) {
  const tier = tierOf(key);
  if (tier === "prime") return "lattice";
  if (tier === "sovereign") return "mythic";
  if (tier === "key") return key.family === "featured" ? "rare" : "uncommon";
  return "common";
}

/**
 * @param {import("./catalog.js").EchoKey} key
 */
export function integrityOf(key) {
  if (key.memory === "dark") return 42;
  if (key.class === "nova") return 88;
  if (key.id === "ember-that-refused") return 95;
  if (key.id === "last-ember") return 38;
  return 62 + ((key.libraryNo || 0) % 23);
}

/**
 * @param {import("./catalog.js").EchoKey} key
 */
export function originSiteOf(key) {
  if (key.originSite) return key.originSite;
  const no = key.libraryNo || key.id.length;
  return no % 2 === 0
    ? SITE_BY_ELEMENT[key.element] || "sacred-place"
    : SITE_BY_MEMORY[key.memory] || "ancient-forest";
}

/**
 * @param {import("./catalog.js").EchoKey} key
 */
export function memoryTextOf(key) {
  if (key.memoryText) return key.memoryText;
  const freq = FREQUENCY_LABEL[frequencyOf(key)];
  const role = roleOf(key);
  return `The Lattice remembered a ${freq.toLowerCase()} ${role} long enough for it to crystallize. ${key.description}`;
}

/**
 * @param {import("./catalog.js").EchoKey | null | undefined} key
 */
export function enrichEchoKey(key) {
  if (!key) return null;
  const tier = tierOf(key);
  const frequency = frequencyOf(key);
  const role = roleOf(key);
  const evolution = ECHO_EVOLUTIONS[key.id] || null;
  return {
    ...key,
    tier,
    frequency,
    role,
    affinity: affinityOf(key),
    cost: key.mb,
    echoIntegrity: integrityOf(key),
    rarity: rarityOf(key),
    originSite: originSiteOf(key),
    memoryText: memoryTextOf(key),
    evolution,
  };
}

/**
 * How readily this Anima can synchronize with the Key.
 * 1 = aligned, <1 = strain, >1 = exceptional lock.
 *
 * @param {import("./catalog.js").EchoKey} key
 * @param {Record<string, number> | null | undefined} spectrum
 */
export function compatibilityScore(key, spectrum) {
  const enriched = enrichEchoKey(key);
  if (!enriched) return 1;
  if (!spectrum) return 1;
  const dominant = dominantExpression(spectrum);
  if (enriched.affinity.includes(dominant.id)) return 1.25;
  if (dominant.id === "neutral") return 1;
  return 0.72;
}

export function echoKeyCanonLine() {
  return "Echo Keys are crystallized memories of function that an Anima can temporarily synchronize with and execute.";
}
