// @ts-check
/**
 * Story-mode Echo Key discovery.
 *
 * Canonical rule: Echo Keys emerge wherever experience becomes sufficiently
 * resonant that the Lattice remembers it. Nature is prime territory. So are
 * battlefields, graveyards, and ruins — coherence, not pleasantness.
 *
 * Field attune may use geolocation to guess a biome. Raw coordinates are
 * never persisted — only a biome class and timestamp.
 */

import { ECHO_KEYS, ECHO_KEY_BY_ID } from "./catalog.js";
import { CARTRIDGE_IDS, CANON_FUSION_RECIPES } from "./canon.js";
import { enrichEchoKey } from "./resonance.js";
import { grantOwnedKey } from "./account.js";

/** @typedef {import("./account.js").EchoKeyAccount} EchoKeyAccount */

export const VIRTUAL_ATTUNE_COOLDOWN_MS = 45 * 60 * 1000;
export const FIELD_ATTUNE_COOLDOWN_MS = 12 * 60 * 1000;

export const EVOLUTION_ONLY_IDS = new Set(["ember-that-refused"]);
export const SYNTHESIS_ONLY_IDS = new Set(["firestorm", "mourning-gate", ...CARTRIDGE_IDS]);

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   emoji: string,
 *   biome: string,
 *   coherence: "ecological" | "catastrophic" | "communal" | "sacred" | "celestial",
 *   outdoor: boolean,
 *   frequencies: string[],
 *   roles: string[],
 *   memories: string[],
 *   featuredIds: string[],
 *   hint: string,
 *   blurb: string,
 * }} ResonanceSite
 */

/** @type {ResonanceSite[]} */
export const RESONANCE_SITES = [
  {
    id: "ancient-forest",
    name: "Ancient Forest",
    emoji: "🌲",
    biome: "forest",
    coherence: "ecological",
    outdoor: true,
    frequencies: ["verdant", "umbral"],
    roles: ["field", "support", "combat"],
    memories: ["weapon", "field"],
    featuredIds: [],
    hint: "Interconnected rhythm held for centuries.",
    blurb: "Millions of organisms keeping the same ecological pulse. Nature is one of the richest places a Shard can surface.",
  },
  {
    id: "living-water",
    name: "River, Sea, or Fall",
    emoji: "🌊",
    biome: "water",
    coherence: "ecological",
    outdoor: true,
    frequencies: ["aqueous", "voltaic"],
    roles: ["support", "traversal", "combat"],
    memories: ["weapon", "wave"],
    featuredIds: ["gale-key"],
    hint: "Repeating natural rhythms, unusually stable harmonics.",
    blurb: "Water remembers in cycles. A shoreline, a waterfall, or a long river will do.",
  },
  {
    id: "stone-hold",
    name: "Mountain or Cave",
    emoji: "🏔️",
    biome: "mountain",
    coherence: "ecological",
    outdoor: true,
    frequencies: ["umbral", "verdant", "voltaic"],
    roles: ["field", "combat", "veil"],
    memories: ["weapon", "field"],
    featuredIds: [],
    hint: "Geological stillness that preserves very old Echoes.",
    blurb: "Stone keeps time the Lattice can still read.",
  },
  {
    id: "sanctuary-garden",
    name: "Garden or Sanctuary",
    emoji: "🌸",
    biome: "garden",
    coherence: "sacred",
    outdoor: true,
    frequencies: ["verdant", "aqueous", "umbral"],
    roles: ["veil", "support", "memory"],
    memories: ["field", "plus"],
    featuredIds: ["veil-key"],
    hint: "Where human intention and natural resonance stayed aligned.",
    blurb: "A tended garden is a small civilization of care.",
  },
  {
    id: "celestial-sky",
    name: "Open Sky",
    emoji: "🌌",
    biome: "celestial",
    coherence: "celestial",
    outdoor: true,
    frequencies: ["voltaic", "umbral"],
    roles: ["combat", "traversal", "disrupt"],
    memories: ["wave", "nova"],
    featuredIds: [],
    hint: "Conjunctions, night air, gravitational quiet.",
    blurb: "Look up. The Lattice is thinner where the sky is honest.",
  },
  {
    id: "sacred-place",
    name: "Sacred or Historic Ground",
    emoji: "🏛️",
    biome: "sacred",
    coherence: "sacred",
    outdoor: false,
    frequencies: ["umbral", "voltaic", "verdant"],
    roles: ["memory", "veil", "support"],
    memories: ["plus", "brother", "weapon"],
    featuredIds: ["memory-echo"],
    hint: "Accumulated consciousness leaves a signature.",
    blurb: "Temples, halls, and old civic stones. Not always peaceful — always coherent.",
  },
  {
    id: "human-bond",
    name: "Place of Bond",
    emoji: "❤️",
    biome: "bond",
    coherence: "communal",
    outdoor: false,
    frequencies: ["umbral", "aqueous", "pyric"],
    roles: ["memory", "support", "veil"],
    memories: ["brother", "plus"],
    featuredIds: ["memory-echo"],
    hint: "Generations of love, craft, or community in one location.",
    blurb: "A kitchen table can hold as much resonance as a cathedral.",
  },
  {
    id: "old-battlefield",
    name: "Old Battlefield",
    emoji: "⚔️",
    biome: "battlefield",
    coherence: "catastrophic",
    outdoor: true,
    frequencies: ["pyric", "umbral"],
    roles: ["combat", "disrupt", "memory"],
    memories: ["dark", "weapon"],
    featuredIds: ["last-ember", "grief-echo", "pyre-key"],
    hint: "Thousands of minds meeting the same catastrophic moment.",
    blurb: "Harmony is not the same as peace. Storms are remembered clearly.",
  },
  {
    id: "quiet-yard",
    name: "Graveyard or Memorial",
    emoji: "🕊️",
    biome: "memorial",
    coherence: "catastrophic",
    outdoor: true,
    frequencies: ["umbral", "aqueous"],
    roles: ["memory", "veil", "disrupt"],
    memories: ["plus", "field", "dark"],
    featuredIds: ["grief-echo"],
    hint: "Grief held in the same place, year after year.",
    blurb: "A memorial is a designed Echo. The Lattice already knows the shape.",
  },
  {
    id: "fallen-ruin",
    name: "Ruins of a Civilization",
    emoji: "🏚️",
    biome: "ruin",
    coherence: "catastrophic",
    outdoor: true,
    frequencies: ["pyric", "umbral", "voltaic"],
    roles: ["memory", "combat", "field"],
    memories: ["weapon", "dark", "field"],
    featuredIds: ["last-ember", "pyre-key"],
    hint: "A city that stopped mid-sentence.",
    blurb: "Last Ember waits where a settlement's final flame was still coherent enough to keep.",
  },
];

export const FUSION_RECIPES = [
  { ids: ["pyre-key", "gale-key"], result: "firestorm", name: "Firestorm" },
  { ids: ["grief-echo", "memory-echo", "veil-key"], result: "mourning-gate", name: "Mourning Gate" },
  ...CANON_FUSION_RECIPES,
];

const BIOME_TO_SITE = {
  forest: "ancient-forest",
  water: "living-water",
  mountain: "stone-hold",
  garden: "sanctuary-garden",
  celestial: "celestial-sky",
  sacred: "sacred-place",
  bond: "human-bond",
  ruin: "fallen-ruin",
  battlefield: "old-battlefield",
  memorial: "quiet-yard",
};

/**
 * Classify a location without storing coordinates.
 * @param {number} lat
 * @param {number} lng
 */
export function biomeFromCoords(lat, lng) {
  const alat = Math.abs(Number(lat));
  const alng = Number(lng);
  if (!Number.isFinite(alat) || !Number.isFinite(alng)) return "forest";
  if (alat > 66) return "celestial";
  if (alat > 55) return "mountain";
  const h = Math.abs(Math.round(lat * 4) + Math.round(lng * 4)) % 6;
  return ["forest", "water", "garden", "ruin", "sacred", "bond"][h];
}

/** @param {string} biome */
export function siteIdFromBiome(biome) {
  return BIOME_TO_SITE[biome] || "ancient-forest";
}

/** @param {string} siteId */
export function getResonanceSite(siteId) {
  return RESONANCE_SITES.find((s) => s.id === siteId) || null;
}

/**
 * @param {ResonanceSite} site
 * @param {import("./catalog.js").EchoKey} key
 */
export function siteMatchesKey(site, key) {
  if (site.featuredIds.includes(key.id)) return true;
  const enriched = enrichEchoKey(key);
  if (!enriched) return false;
  if (enriched.originSite === site.id) return true;
  const freqOk = site.frequencies.includes(enriched.frequency);
  const roleOk = site.roles.includes(enriched.role);
  const memOk = site.memories.includes(key.memory);
  return freqOk && (roleOk || memOk);
}

/**
 * @param {EchoKeyAccount} account
 * @param {string} siteId
 * @param {{ field?: boolean, now?: number }} [opts]
 */
export function siteCooldownRemaining(account, siteId, opts = {}) {
  const field = !!opts.field;
  const now = opts.now ?? Date.now();
  const stamp = account.sites_attuned?.[siteId];
  if (!stamp) return 0;
  const elapsed = now - Date.parse(stamp);
  const window = field ? FIELD_ATTUNE_COOLDOWN_MS : VIRTUAL_ATTUNE_COOLDOWN_MS;
  return Math.max(0, window - elapsed);
}

/**
 * @param {import("./catalog.js").EchoKey[]} pool
 * @param {boolean} field
 * @param {() => number} rng
 */
function weightedPick(pool, field, rng) {
  const weights = pool.map((k) => {
    const tier = enrichEchoKey(k)?.tier;
    if (tier === "shard") return field ? 5 : 10;
    if (tier === "key") return field ? 6 : 2.2;
    if (tier === "sovereign") return field ? 0.35 : 0;
    return 0;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pool[0] || null;
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * @param {EchoKeyAccount} account
 * @param {string} siteId
 * @param {{ field?: boolean, rng?: () => number, now?: number, at?: string }} [opts]
 */
export function discoverAtSite(account, siteId, opts = {}) {
  const site = getResonanceSite(siteId);
  if (!site) return { ok: false, error: "Unknown resonance site." };

  const field = !!opts.field;
  const rng = opts.rng || Math.random;
  const now = opts.now ?? Date.now();
  const remaining = siteCooldownRemaining(account, siteId, { field, now });
  if (remaining > 0) {
    const mins = Math.ceil(remaining / 60000);
    return { ok: false, error: `This site is still settling (${mins}m). Coherence is not a loot box.` };
  }

  const owned = new Set(account.owned);
  const pool = ECHO_KEYS.filter((k) => {
    if (owned.has(k.id)) return false;
    if (EVOLUTION_ONLY_IDS.has(k.id) || SYNTHESIS_ONLY_IDS.has(k.id)) return false;
    const enriched = enrichEchoKey(k);
    if (!enriched) return false;
    if (enriched.tier === "prime") return false;
    if (enriched.tier === "sovereign" && !field) return false;
    return siteMatchesKey(site, k);
  });

  if (!pool.length) {
    return { ok: false, error: "The Lattice remembers nothing new here yet. Try another site, or synthesise." };
  }

  const pick = weightedPick(pool, field, rng);
  if (!pick) {
    return { ok: false, error: "The Lattice remembers nothing new here yet." };
  }

  const at = opts.at || new Date(now).toISOString();
  const next = grantOwnedKey(account, pick.id, {
    source: field ? "field" : "virtual",
    site: siteId,
    outdoor: field || site.outdoor,
    at,
  });
  const sites_attuned = { ...(next.sites_attuned || {}), [siteId]: at };
  return {
    ok: true,
    key: enrichEchoKey(pick),
    account: { ...next, sites_attuned },
    source: field ? "field" : "virtual",
    site,
  };
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}

/**
 * @param {EchoKeyAccount} account
 * @param {string[]} ingredientIds
 * @param {{ at?: string }} [opts]
 */
export function synthesiseEchoKeys(account, ingredientIds, opts = {}) {
  const ids = [...new Set((ingredientIds || []).filter((id) => typeof id === "string" && id))];
  const recipe = FUSION_RECIPES.find((r) => sameSet(r.ids, ids));
  if (!recipe && (ids.length < 2 || ids.length > 3)) {
    return { ok: false, error: "Echo Sequences need two or three compatible Keys, or an explicit cartridge recipe." };
  }
  if (ids.length < 2) {
    return { ok: false, error: "Echo Sequences need at least two compatible Keys." };
  }
  const owned = new Set(account.owned);
  if (!ids.every((id) => owned.has(id))) {
    return { ok: false, error: "You do not hold every ingredient." };
  }

  const at = opts.at || new Date().toISOString();
  if (recipe) {
    if (owned.has(recipe.result)) {
      return { ok: false, error: "That Sequence already lives in your Vault." };
    }
    const key = ECHO_KEY_BY_ID[recipe.result];
    const next = grantOwnedKey(account, recipe.result, {
      source: "synthesis",
      site: null,
      outdoor: false,
      at,
    });
    const fusion_log = [...(next.fusion_log || []), { result: recipe.result, ingredients: ids, at }];
    return { ok: true, key: enrichEchoKey(key), account: { ...next, fusion_log }, recipe: recipe.name };
  }

  if (ids.length === 2) {
    const a = enrichEchoKey(ECHO_KEY_BY_ID[ids[0]]);
    const b = enrichEchoKey(ECHO_KEY_BY_ID[ids[1]]);
    if (a && b && a.frequency === b.frequency && a.tactic !== b.tactic) {
      const candidate = ECHO_KEYS.find((k) => {
        if (owned.has(k.id) || EVOLUTION_ONLY_IDS.has(k.id) || SYNTHESIS_ONLY_IDS.has(k.id)) return false;
        if (k.sources?.includes("canon")) return false;
        const e = enrichEchoKey(k);
        return e && e.frequency === a.frequency && e.tier === "key";
      });
      if (candidate) {
        const next = grantOwnedKey(account, candidate.id, {
          source: "synthesis",
          site: null,
          outdoor: false,
          at,
        });
        const fusion_log = [...(next.fusion_log || []), { result: candidate.id, ingredients: ids, at }];
        return {
          ok: true,
          key: enrichEchoKey(candidate),
          account: { ...next, fusion_log },
          recipe: `${a.name} × ${b.name}`,
        };
      }
    }
  }

  return { ok: false, error: "These Keys refuse to braid. Alignment is not enough — try Pyre + Gale, or Grief + Memory + Veil." };
}

/**
 * Count a survived-critical battle toward Last Ember → Ember That Refused.
 *
 * @param {EchoKeyAccount} account
 * @param {{ folderIds?: string[], integrityRatio: number, survived: boolean, at?: string }} opts
 */
export function recordCriticalBattle(account, opts) {
  const threshold = 0.3;
  if (!opts.survived || opts.integrityRatio >= threshold) {
    return { account, evolved: null, progressed: false };
  }
  const folderIds = opts.folderIds || [];
  const holding =
    account.owned.includes("last-ember") &&
    (folderIds.length === 0 || folderIds.includes("last-ember"));
  if (!holding) return { account, evolved: null, progressed: false };

  const n = (account.evolutions?.["last-ember"] || 0) + 1;
  let next = {
    ...account,
    evolutions: { ...(account.evolutions || {}), "last-ember": n },
  };
  if (n >= 3 && !next.owned.includes("ember-that-refused")) {
    const at = opts.at || new Date().toISOString();
    next = grantOwnedKey(next, "ember-that-refused", {
      source: "evolution",
      site: null,
      outdoor: false,
      at,
    });
    return { account: next, evolved: enrichEchoKey(ECHO_KEY_BY_ID["ember-that-refused"]), progressed: true };
  }
  return { account: next, evolved: null, progressed: true };
}
