// @ts-check
import { ENERGY_FRAGMENTS, FRAGMENT_BY_ID } from "./catalog.js";

/** Folder rules, remixed from BN3+ (Standard / Mega / Giga). */
export const FOLDER_RULES = {
  size: 30,
  maxCopiesStandard: 4,
  maxApex: 5,
  maxCopiesApex: 1,
  maxNova: 1,
};

/** Ember > Grove > Tide > Ember. Volt doubles vs Tide and vs other Volt (code-on-code). Void has no bonus. */
/** @type {Record<string, string | null>} */
export const ELEMENT_WEAKNESS = {
  grove: "ember",
  tide: "grove",
  ember: "tide",
  volt: null,
  void: null,
};

/** BN6-style tactic cycle: Blade > Gale > Mark > Shatter > Blade. */
/** @type {Record<string, string | null>} */
export const TACTIC_WEAKNESS = {
  gale: "blade",
  mark: "gale",
  shatter: "mark",
  blade: "shatter",
  none: null,
  summon: null,
  mend: null,
};

/** @type {Record<string, { element: string, tactic: string }>} */
export const VIRUS_AFFINITY = {
  EvalWorm: { element: "volt", tactic: "none" },
  FuncForge: { element: "volt", tactic: "none" },
  CookieLeech: { element: "tide", tactic: "mark" },
  DataSiphon: { element: "tide", tactic: "mark" },
  FrameBreaker: { element: "void", tactic: "shatter" },
  ShellCrawler: { element: "void", tactic: "shatter" },
  SysCrawler: { element: "void", tactic: "shatter" },
  ProtoVirus: { element: "volt", tactic: "none" },
  CryptoLeech: { element: "ember", tactic: "none" },
  VaultPeeker: { element: "void", tactic: "mark" },
  ModuleGhost: { element: "void", tactic: "gale" },
  LoopLocker: { element: "grove", tactic: "none" },
  SensorSpy: { element: "void", tactic: "mark" },
  Redirector: { element: "void", tactic: "gale" },
  MarkupMite: { element: "grove", tactic: "none" },
  FileMite: { element: "grove", tactic: "none" },
};

/** @type {{ id: string, name: string, requires: string[], power: number, summon: string, description: string }[]} */
export const RESONANCE_COMBOS = [
  {
    id: "nova-pulse",
    name: "Nova Pulse",
    requires: ["pulse-emitter", "high-pulse", "apex-pulse"],
    power: 400,
    summon: "cannon",
    description: "Three pulse barrels stack into one cathedral shot.",
  },
  {
    id: "life-veil",
    name: "Life Veil",
    requires: ["phantom-edge", "wide-phantom", "long-phantom"],
    power: 400,
    summon: "sword",
    description: "Three phantom blades become a single horizon cut.",
  },
  {
    id: "chain-bloom",
    name: "Chain Bloom",
    requires: ["ember-seed", "twin-seed", "cross-seed"],
    power: 300,
    summon: "bomb",
    description: "Seeds daisy-chain across the enemy area.",
  },
  {
    id: "prism-storm",
    name: "Prism Storm",
    requires: ["prism-lance", "star-vein", "rift-needle"],
    power: 280,
    summon: "prism",
    description: "Original Anima resonance — lock, slit, and split-light at once.",
  },
];

const STARTER_IDS = [
  "pulse-emitter",
  "pulse-emitter",
  "high-pulse",
  "halo-burst",
  "halo-burst",
  "ember-seed",
  "ember-seed",
  "cross-seed",
  "phantom-edge",
  "phantom-edge",
  "wide-phantom",
  "long-phantom",
  "cinder-veil",
  "tremor-veil",
  "flame-spire",
  "geist-fist",
  "tri-gleam",
  "homing-wisp",
  "ether-gyre",
  "mend-50",
  "mend-50",
  "met-veil",
  "null-veil",
  "claim-column",
  "aether-sail",
  "needle-burst",
  "prism-lance",
  "rift-needle",
  "fade-1",
  "jack-out",
];

/**
 * @param {string} id
 * @param {string} [code]
 */
export function makeCopy(id, code) {
  const frag = FRAGMENT_BY_ID[id];
  if (!frag) throw new Error(`Unknown fragment: ${id}`);
  const chosen = code && frag.codes.includes(code) ? code : frag.codes[0];
  return { id: frag.id, code: chosen };
}

export function starterFolder() {
  return STARTER_IDS.map((id) => makeCopy(id));
}

/**
 * @param {{ id: string, code: string }[]} folder
 */
export function validateFolder(folder) {
  /** @type {string[]} */
  const errors = [];
  if (folder.length !== FOLDER_RULES.size) {
    errors.push(`Folder must hold ${FOLDER_RULES.size} fragments (has ${folder.length}).`);
  }
  /** @type {Record<string, number>} */
  const copies = {};
  let apex = 0;
  let nova = 0;
  for (const slot of folder) {
    const frag = FRAGMENT_BY_ID[slot.id];
    if (!frag) {
      errors.push(`Unknown fragment ${slot.id}.`);
      continue;
    }
    if (!frag.codes.includes(slot.code)) {
      errors.push(`${frag.name} has no code ${slot.code}.`);
    }
    copies[slot.id] = (copies[slot.id] || 0) + 1;
    if (frag.class === "apex") apex += 1;
    if (frag.class === "nova") nova += 1;
  }
  for (const [id, n] of Object.entries(copies)) {
    const frag = FRAGMENT_BY_ID[id];
    if (!frag) continue;
    if (frag.class === "standard" && n > FOLDER_RULES.maxCopiesStandard) {
      errors.push(`${frag.name}: max ${FOLDER_RULES.maxCopiesStandard} copies.`);
    }
    if (frag.class === "apex" && n > FOLDER_RULES.maxCopiesApex) {
      errors.push(`${frag.name}: Apex copies capped at ${FOLDER_RULES.maxCopiesApex}.`);
    }
    if (frag.class === "nova" && n > 1) {
      errors.push(`${frag.name}: Nova copies capped at 1.`);
    }
  }
  if (apex > FOLDER_RULES.maxApex) errors.push(`Max ${FOLDER_RULES.maxApex} Apex fragments.`);
  if (nova > FOLDER_RULES.maxNova) errors.push(`Max ${FOLDER_RULES.maxNova} Nova fragment.`);
  return { ok: errors.length === 0, errors };
}

/**
 * Two copies can be selected together if they share a name or a code.
 * `*` is a wildcard (BN2+ asterisk).
 * @param {{ id: string, code: string }} a
 * @param {{ id: string, code: string }} b
 */
export function codesMatch(a, b) {
  if (a.id === b.id) return true;
  if (a.code === "*" || b.code === "*") return true;
  return a.code === b.code;
}

/**
 * Same-name chain OR same-code chain (asterisk included).
 * @param {{ id: string, code: string }[]} selected
 */
export function selectionIsLinked(selected) {
  if (selected.length <= 1) return true;
  const ids = new Set(selected.map((s) => s.id));
  if (ids.size === 1) return true;
  const codes = selected.map((s) => s.code);
  if (codes.includes("*")) return true;
  return new Set(codes).size === 1;
}

/**
 * @param {string[]} selectedIds
 */
export function findResonance(selectedIds) {
  const sorted = [...selectedIds].sort();
  return (
    RESONANCE_COMBOS.find((combo) => {
      if (combo.requires.length !== selectedIds.length) return false;
      return [...combo.requires].sort().every((id, i) => id === sorted[i]);
    }) || null
  );
}

/**
 * @param {string} fragmentElement
 * @param {string} virusElement
 */
export function elementMultiplier(fragmentElement, virusElement) {
  if (fragmentElement === "volt" && (virusElement === "tide" || virusElement === "volt")) return 2;
  if (ELEMENT_WEAKNESS[virusElement] === fragmentElement) return 2;
  return 1;
}

/**
 * @param {string} fragmentTactic
 * @param {string} virusTactic
 */
export function tacticMultiplier(fragmentTactic, virusTactic) {
  if (TACTIC_WEAKNESS[virusTactic] === fragmentTactic) return 2;
  return 1;
}

/**
 * @param {import("./catalog.js").EnergyFragment} fragment
 * @param {{ codename?: string, severity?: string }[]} findings
 */
export function effectivenessVsScan(fragment, findings) {
  if (!findings?.length) {
    return { multiplier: 1, reasons: [], recommended: false };
  }
  let best = 1;
  /** @type {string[]} */
  const reasons = [];
  for (const f of findings) {
    const aff = VIRUS_AFFINITY[f.codename || ""] || { element: "void", tactic: "none" };
    const em = elementMultiplier(fragment.element, aff.element);
    const tm = tacticMultiplier(fragment.tactic, aff.tactic);
    const m = Math.max(em, tm);
    if (em > 1) reasons.push(`${fragment.name} is super-effective vs ${f.codename} (${fragment.element} > ${aff.element})`);
    if (tm > 1) reasons.push(`${fragment.name} tactic ${fragment.tactic} beats ${f.codename}'s ${aff.tactic}`);
    if (m > best) best = m;
  }
  const high = findings.some((f) => f.severity === "high");
  const recommended = best > 1 || (high && (fragment.class !== "standard" || (fragment.power || 0) >= 100));
  return { multiplier: best, reasons, recommended };
}

/**
 * Rank a hand for a virus scan. Higher score = better slot.
 * @param {import("./catalog.js").EnergyFragment[]} hand
 * @param {{ codename?: string, severity?: string }[]} findings
 */
export function rankHand(hand, findings) {
  const maxSev = findings.reduce((m, f) => (f.severity === "high" ? "high" : m === "high" ? "high" : f.severity || m), "none");
  return [...hand]
    .map((frag) => {
      const eff = effectivenessVsScan(frag, findings);
      let score = (frag.power || 0) * eff.multiplier;
      if (frag.tactic === "mend" && maxSev !== "high") score += 20;
      if (frag.id === "data-silence") score += 40;
      if (frag.id === "jack-out") score -= 50;
      return { fragment: frag, ...eff, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Draw `n` unique-slot copies from a folder (with replacement of copies).
 * @param {{ id: string, code: string }[]} folder
 * @param {number} n
 * @param {() => number} [rng]
 */
export function drawHand(folder, n = 5, rng = Math.random) {
  const pool = [...folder];
  /** @type {{ id: string, code: string }[]} */
  const hand = [];
  while (hand.length < n && pool.length) {
    const i = Math.floor(rng() * pool.length);
    hand.push(pool.splice(i, 1)[0]);
  }
  return hand;
}

export function allFragmentIds() {
  return ENERGY_FRAGMENTS.map((f) => f.id);
}

export function coveredSourceFamilies() {
  return [...new Set(ENERGY_FRAGMENTS.map((f) => f.inspiredByFamily))];
}
