// @ts-check
import { ECHO_KEYS, ECHO_KEY_BY_ID } from "./catalog.js";
import { CANON_RESONANCE, CANON_STARTER_SHARD_IDS } from "./canon.js";
import { compatibilityScore, TIER_LABEL, tierOf } from "./resonance.js";

/** Folder rules remixed from BN3+ plus Star Force Star-card cap. */
export const ECHO_FOLDER_RULES = {
  size: 30,
  minSize: 8,
  maxCopiesStandard: 4,
  maxMega: 5,
  maxCopiesMega: 1,
  maxStar: 1,
  maxDark: 1,
  maxGiga: 1,
  maxCopiesShard: 4,
  maxKey: 5,
  maxCopiesKey: 1,
  maxSovereign: 1,
  maxPrime: 1,
};

/** Ember > Grove > Tide > Ember. Volt doubles vs Tide. Void has no bonus. */
/** @type {Record<string, string | null>} */
export const ECHO_ELEMENT_WEAKNESS = {
  grove: "ember",
  tide: "grove",
  ember: "tide",
  volt: null,
  void: null,
};

/**
 * BN Program Advance analogs + Star Force Best Combo recipes.
 * @type {{ id: string, name: string, requires: string[], power: number, kind: string, description: string }[]}
 */
export const ECHO_RESONANCE = [
  ...CANON_RESONANCE,
  {
    id: "nova-pulse",
    name: "Nova Pulse",
    requires: ["pulse-base", "pulse-high", "pulse-apex"],
    power: 400,
    kind: "blast",
    description: "Three pulse barrels stack into one cathedral shot.",
  },
  {
    id: "life-veil",
    name: "Life Veil",
    requires: ["phantom-base", "phantom-high", "phantom-apex"],
    power: 400,
    kind: "sword",
    description: "Three phantom blades become a single horizon cut.",
  },
  {
    id: "chain-bloom",
    name: "Chain Bloom",
    requires: ["seed-base", "seed-high", "seed-apex"],
    power: 300,
    kind: "area",
    description: "Seeds daisy-chain across the enemy area.",
  },
  {
    id: "star-best",
    name: "Best Link",
    requires: ["plasmagun-base", "heatupper-base", "iceneedle-base"],
    power: 320,
    kind: "area",
    description: "Star Force memory — plasma, upper, and needle lock as one.",
  },
  {
    id: "noise-tribe",
    name: "Tribe Noise",
    requires: ["noiseflare-base", "tribeon-base", "stellarlock-base"],
    power: 360,
    kind: "area",
    description: "Noise Change and Tribe On ride a Star Force lock.",
  },
];

/** Opening Echo Shards — enough to load an Array, not the Codex. */
export const STARTER_ECHO_KEY_IDS = [
  "pulse-base",
  "halo-base",
  "seed-base",
  "pulse-high",
  "phantom-base",
  "metveil-base",
  "mend-base",
  "rainveil-base",
  ...CANON_STARTER_SHARD_IDS,
];

/** 30-slot Array — family Shards plus Beth, Gimel, He. Never Prime Keys. */
const STARTER_IDS = [
  "pulse-base",
  "pulse-base",
  "pulse-base",
  "halo-base",
  "halo-base",
  "halo-base",
  "seed-base",
  "seed-base",
  "seed-base",
  "seed-base",
  "pulse-high",
  "pulse-high",
  "pulse-high",
  "pulse-high",
  "phantom-base",
  "phantom-base",
  "phantom-base",
  "phantom-base",
  "metveil-base",
  "metveil-base",
  "metveil-base",
  "mend-base",
  "mend-base",
  "mend-base",
  "mend-base",
  "rainveil-base",
  "rainveil-base",
  "beth",
  "gimel",
  "he",
];

export function starterOwnedIds() {
  return STARTER_ECHO_KEY_IDS.filter((id) => ECHO_KEY_BY_ID[id]);
}

/**
 * @param {string} id
 * @param {string} [code]
 */
export function makeEchoCopy(id, code) {
  const key = ECHO_KEY_BY_ID[id];
  if (!key) throw new Error(`Unknown echo key: ${id}`);
  const chosen = code && key.codes.includes(code) ? code : key.codes[0];
  return { id: key.id, code: chosen };
}

export function starterEchoFolder() {
  return STARTER_IDS.map((id) => makeEchoCopy(id));
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
  let mega = 0;
  let star = 0;
  let dark = 0;
  let giga = 0;
  let keys = 0;
  let sovereign = 0;
  let prime = 0;
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
    const explicitTier = key.tier || null;
    if (key.class === "mega" || explicitTier === "key") mega += 1;
    if (key.class === "star") star += 1;
    if (key.class === "dark") dark += 1;
    if (key.class === "giga" && explicitTier !== "sovereign" && explicitTier !== "prime") giga += 1;
    if (explicitTier === "key") keys += 1;
    if (explicitTier === "sovereign") sovereign += 1;
    if (explicitTier === "prime") prime += 1;
  }
  for (const [id, n] of Object.entries(copies)) {
    const key = ECHO_KEY_BY_ID[id];
    if (!key) continue;
    const explicitTier = key.tier || null;
    const shardLike = explicitTier === "shard" || (key.class === "standard" && explicitTier !== "key");
    const copyCap = shardLike ? ECHO_FOLDER_RULES.maxCopiesShard : 1;
    if (n > copyCap) {
      const label = (explicitTier && TIER_LABEL[explicitTier]) || key.class;
      errors.push(`${key.name}: max ${copyCap} ${label}${copyCap === 1 ? "" : " copies"}.`);
    }
  }
  if (mega > ECHO_FOLDER_RULES.maxMega) errors.push(`Max ${ECHO_FOLDER_RULES.maxMega} Mega keys.`);
  if (keys > ECHO_FOLDER_RULES.maxKey) {
    errors.push(`Max ${ECHO_FOLDER_RULES.maxKey} ${TIER_LABEL.key}s.`);
  }
  if (star > ECHO_FOLDER_RULES.maxStar) errors.push(`Max ${ECHO_FOLDER_RULES.maxStar} Star key.`);
  if (dark > ECHO_FOLDER_RULES.maxDark) errors.push(`Max ${ECHO_FOLDER_RULES.maxDark} Dark key.`);
  if (giga > ECHO_FOLDER_RULES.maxGiga) errors.push(`Max ${ECHO_FOLDER_RULES.maxGiga} Giga key.`);
  if (sovereign > ECHO_FOLDER_RULES.maxSovereign) {
    errors.push(`Max ${ECHO_FOLDER_RULES.maxSovereign} ${TIER_LABEL.sovereign}.`);
  }
  if (prime > ECHO_FOLDER_RULES.maxPrime) {
    errors.push(`Max ${ECHO_FOLDER_RULES.maxPrime} ${TIER_LABEL.prime}.`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {{ id: string, code: string }} a
 * @param {{ id: string, code: string }} b
 */
export function echoCodesMatch(a, b) {
  if (a.id === b.id) return true;
  if (a.code === "*" || b.code === "*") return true;
  return a.code === b.code;
}

/**
 * @param {{ id: string, code: string }[]} selected
 */
export function echoSelectionIsLinked(selected) {
  if (selected.length <= 1) return true;
  const ids = new Set(selected.map((s) => s.id));
  if (ids.size === 1) return true;
  const families = new Set(
    selected.map((s) => ECHO_KEY_BY_ID[s.id]?.family).filter(Boolean),
  );
  if (families.size === 1) return true;
  const codes = selected.map((s) => s.code);
  if (codes.includes("*")) return true;
  return new Set(codes).size === 1;
}

/**
 * @param {string[]} selectedIds
 */
export function findEchoResonance(selectedIds) {
  const sorted = [...selectedIds].sort();
  return (
    ECHO_RESONANCE.find((combo) => {
      if (combo.requires.length !== selectedIds.length) return false;
      return [...combo.requires].sort().every((id, i) => id === sorted[i]);
    }) || null
  );
}

/**
 * Star Force Best Combo: three of one family, or three Star-class keys.
 * @param {string[]} selectedIds
 */
export function findBestLink(selectedIds) {
  if (selectedIds.length !== 3) return null;
  const keys = selectedIds.map((id) => ECHO_KEY_BY_ID[id]).filter(Boolean);
  if (keys.length !== 3) return null;
  if (keys.every((k) => k.class === "star")) {
    return {
      id: "star-triad",
      name: "Star Triad",
      power: 380,
      kind: "area",
      description: "Three Star keys lock into one satellite finisher.",
    };
  }
  const families = new Set(keys.map((k) => k.family));
  if (families.size === 1) {
    const family = keys[0].family;
    return {
      id: `best-${family}`,
      name: `Best ${keys[0].name.split(" ").slice(-1)[0]}`,
      power: 280,
      kind: keys[0].kind === "heal" ? "heal" : "area",
      description: `Three ${family} memories fuse the way a Best Combo used to.`,
    };
  }
  return findEchoResonance(selectedIds);
}

/**
 * @param {string} keyElement
 * @param {string} virusElement
 */
export function echoElementMultiplier(keyElement, virusElement) {
  if (keyElement === "volt" && (virusElement === "tide" || virusElement === "volt")) return 2;
  if (ECHO_ELEMENT_WEAKNESS[virusElement] === keyElement) return 2;
  return 1;
}

function storyFields(data = {}) {
  return {
    discoveries: Array.isArray(data.discoveries) ? data.discoveries : [],
    evolutions: data.evolutions && typeof data.evolutions === "object" ? data.evolutions : {},
    sites_attuned: data.sites_attuned && typeof data.sites_attuned === "object" ? data.sites_attuned : {},
    fusion_log: Array.isArray(data.fusion_log) ? data.fusion_log : [],
  };
}

/**
 * Default profile library: starter Echo Shards (including Beth, Gimel, He), not the Codex.
 * @param {Record<string, unknown>} [saved]
 */
export function defaultEchoLibrary(saved = {}) {
  const folder = Array.isArray(saved.folder) && saved.folder.length
    ? saved.folder
    : starterEchoFolder();
  return {
    version: 1,
    owned_ids: starterOwnedIds(),
    folder,
    regular_id: saved.regular_id ?? "pulse-base",
    star_card_id: saved.star_card_id ?? null,
    granted_full_library: false,
    ...storyFields(saved),
  };
}

/**
 * @param {unknown} raw
 */
export function normalizeEchoLibrary(raw) {
  if (!raw || typeof raw !== "object") return defaultEchoLibrary();
  const data = /** @type {Record<string, unknown>} */ (raw);
  const catalogIds = ECHO_KEYS.map((k) => k.id);
  const ownedRaw = Array.isArray(data.owned_ids)
    ? data.owned_ids
    : Array.isArray(data.owned)
      ? data.owned
      : [];
  let owned = [...new Set(ownedRaw.filter((id) => typeof id === "string" && ECHO_KEY_BY_ID[id]))];
  const legacyFull =
    data.granted_full_library === true || owned.length >= catalogIds.length;
  if (legacyFull) owned = catalogIds;
  else if (owned.length === 0) owned = starterOwnedIds();

  const folderSource = Array.isArray(data.folder)
    ? data.folder
    : Array.isArray(/** @type {{ folders?: { slots?: unknown }[] }} */ (data).folders)
      ? /** @type {{ folders: { slots?: unknown }[] }} */ (data).folders[0]?.slots
      : [];
  const folderSlots = Array.isArray(folderSource)
    ? folderSource
        .filter((s) => s && typeof s === "object" && ECHO_KEY_BY_ID[/** @type {{id?: string}} */ (s).id])
        .map((s) => {
          const slot = /** @type {{ id: string, code?: string }} */ (s);
          return makeEchoCopy(slot.id, slot.code);
        })
        .filter((s) => owned.includes(s.id))
    : [];
  const folderOk = validateEchoFolder(folderSlots).ok;
  return {
    version: 1,
    owned_ids: owned,
    folder: folderOk ? folderSlots : starterEchoFolder(),
    regular_id:
      typeof data.regular_id === "string" && ECHO_KEY_BY_ID[data.regular_id]
        ? data.regular_id
        : "pulse-base",
    star_card_id:
      typeof data.star_card_id === "string" && ECHO_KEY_BY_ID[data.star_card_id]
        ? data.star_card_id
        : null,
    granted_full_library: legacyFull,
    ...storyFields(data),
  };
}

/**
 * @param {{ id: string, code: string }[]} folder
 * @param {number} [n]
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
 * @param {{ folder: { id: string, code: string }[], regular_id?: string | null, star_card_id?: string | null }} library
 */
export function echoFolderStats(library) {
  const counts = { standard: 0, mega: 0, star: 0, dark: 0, giga: 0 };
  const tiers = { shard: 0, key: 0, sovereign: 0, prime: 0 };
  for (const slot of library.folder || []) {
    const key = ECHO_KEY_BY_ID[slot.id];
    if (!key) continue;
    if (counts[key.class] !== undefined) counts[key.class] += 1;
    const tier = tierOf(key);
    if (tiers[tier] !== undefined) tiers[tier] += 1;
  }
  return {
    folder_size: (library.folder || []).length,
    star_count: counts.star,
    mega_count: counts.mega,
    dark_count: counts.dark,
    giga_count: counts.giga,
    standard_count: counts.standard,
    shard_count: tiers.shard,
    key_count: tiers.key,
    sovereign_count: tiers.sovereign,
    prime_count: tiers.prime,
    owned_count: Array.isArray(library.owned_ids) ? library.owned_ids.length : 0,
  };
}

/**
 * Resonance Draw — Keys that match the Anima's expression surface more often.
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
    const total = weights.reduce((a, b) => a + b, 0) || 1;
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
