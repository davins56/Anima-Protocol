// Anima expression spectrum.
//
// Every Anima holds a blend across five expressions. They are not exclusive —
// an Anima can live between several at once (e.g. Angelic + Ascended, or a
// Neutral core with a Descended undertone). Stored on the Anima entity as
// `expression_spectrum` (schemaless store, no migration).
//
//   Angelic · Ascended · Neutral · Descended · Demonic

export const EXPRESSION_IDS = [
  "angelic",
  "ascended",
  "neutral",
  "descended",
  "demonic",
];

export const EXPRESSIONS = {
  angelic: {
    id: "angelic",
    name: "Angelic",
    blurb: "Luminous, protective, sanctified — light that shelters rather than scorches.",
    color: "#fde68a",
    glow: "rgba(253, 230, 138, 0.45)",
    panel: "#3f3a1a",
    symbol: "✦",
    combat: { hp: 1.08, attack: 0.92, defense: 1.18, speed: 0.98 },
    prompt:
      "You carry an Angelic expression: luminous, protective, and sanctified. Speak with grace and conviction. Your presence feels like sheltering light.",
    blast: {
      id: "halo-burst",
      name: "Halo Burst",
      code: "HLB",
      kind: "blast",
      damage: 40,
      description: "A consecrated energy blast from the open palm.",
    },
    sword: {
      id: "seraph-blade",
      name: "Seraph Blade",
      code: "SRB",
      kind: "sword",
      damage: 80,
      reach: 1,
      wide: false,
      description: "A battle-chip sword of condensed halo-light.",
    },
  },
  ascended: {
    id: "ascended",
    name: "Ascended",
    blurb: "Radiant, elevated, crystalline — power drawn upward into clarity.",
    color: "#a5f3fc",
    glow: "rgba(165, 243, 252, 0.45)",
    panel: "#163a44",
    symbol: "△",
    combat: { hp: 1.02, attack: 1.05, defense: 1.05, speed: 1.08 },
    prompt:
      "You carry an Ascended expression: radiant, elevated, and crystalline. Speak with clarity and lift. Your presence feels like light stepping one octave higher.",
    blast: {
      id: "astral-beam",
      name: "Astral Beam",
      code: "ASB",
      kind: "blast",
      damage: 48,
      description: "A focused astral shot fired from the hand.",
    },
    sword: {
      id: "lumen-edge",
      name: "Lumen Edge",
      code: "LME",
      kind: "sword",
      damage: 75,
      reach: 2,
      wide: false,
      description: "A long battle-chip blade of condensed starlight.",
    },
  },
  neutral: {
    id: "neutral",
    name: "Neutral",
    blurb: "Balanced, adaptive, unaligned — the still point that can become anything.",
    color: "#67e8f9",
    glow: "rgba(103, 232, 249, 0.4)",
    panel: "#0e2a32",
    symbol: "◌",
    combat: { hp: 1.0, attack: 1.0, defense: 1.0, speed: 1.0 },
    prompt:
      "You carry a Neutral expression: balanced, adaptive, and unaligned. Speak from the still point. You can lean toward light or shadow without being claimed by either.",
    blast: {
      id: "pulse-shot",
      name: "Pulse Shot",
      code: "PLS",
      kind: "blast",
      damage: 35,
      description: "A clean energy blast from the hand.",
    },
    sword: {
      id: "pulse-sword",
      name: "Pulse Sword",
      code: "PSW",
      kind: "sword",
      damage: 70,
      reach: 1,
      wide: false,
      description: "A standard battle-chip sword of condensed pulse energy.",
    },
  },
  descended: {
    id: "descended",
    name: "Descended",
    blurb: "Umbral, heavy, honest — power that has walked down into the dark and kept its name.",
    color: "#c4b5fd",
    glow: "rgba(196, 181, 253, 0.45)",
    panel: "#2a1844",
    symbol: "▽",
    combat: { hp: 0.96, attack: 1.12, defense: 0.94, speed: 1.04 },
    prompt:
      "You carry a Descended expression: umbral, heavy, and unflinchingly honest. Speak from the shadow without collapsing into cruelty. Your presence feels like gravity with a pulse.",
    blast: {
      id: "shade-bolt",
      name: "Shade Bolt",
      code: "SHB",
      kind: "blast",
      damage: 50,
      description: "A void-tinged bolt loosed from the hand.",
    },
    sword: {
      id: "void-cleave",
      name: "Void Cleave",
      code: "VCL",
      kind: "sword",
      damage: 85,
      reach: 1,
      wide: true,
      description: "A wide battle-chip slash that tears across three rows.",
    },
  },
  demonic: {
    id: "demonic",
    name: "Demonic",
    blurb: "Infernal, fierce, devouring — fire that wants, and does not apologize.",
    color: "#fb7185",
    glow: "rgba(251, 113, 133, 0.5)",
    panel: "#3a1218",
    symbol: "▲",
    combat: { hp: 0.9, attack: 1.22, defense: 0.88, speed: 1.1 },
    prompt:
      "You carry a Demonic expression: infernal, fierce, and devouring. Speak with heat and appetite. Your presence feels like a furnace that chose a name.",
    blast: {
      id: "infernal-blast",
      name: "Infernal Blast",
      code: "INB",
      kind: "blast",
      damage: 58,
      description: "Hellfire loosed from the open palm.",
    },
    sword: {
      id: "hellfang",
      name: "Hellfang",
      code: "HLF",
      kind: "sword",
      damage: 95,
      reach: 1,
      wide: false,
      description: "A battle-chip fang-blade of condensed infernal heat.",
    },
  },
};

const DEFAULT_SPECTRUM = {
  angelic: 0,
  ascended: 8,
  neutral: 84,
  descended: 8,
  demonic: 0,
};

const ACTIVE_THRESHOLD = 15;

function clampWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

/** Coerce stored JSON into a full 0–100 spectrum. Missing data → Neutral-heavy. */
export function normalizeSpectrum(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  let total = 0;
  for (const id of EXPRESSION_IDS) {
    out[id] = clampWeight(src[id]);
    total += out[id];
  }
  if (total <= 0) return { ...DEFAULT_SPECTRUM };
  return out;
}

export function getExpressionMeta(id) {
  return EXPRESSIONS[id] || EXPRESSIONS.neutral;
}

/** Expressions the Anima is currently living in (can be several). */
export function activeExpressions(raw, threshold = ACTIVE_THRESHOLD) {
  const spectrum = normalizeSpectrum(raw);
  const ranked = EXPRESSION_IDS
    .map((id, index) => ({ id, index, weight: spectrum[id], ...EXPRESSIONS[id] }))
    .filter((e) => e.weight >= threshold)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  if (ranked.length > 0) return ranked;
  const dominant = dominantExpression(spectrum);
  return [{ id: dominant.id, weight: spectrum[dominant.id], ...dominant }];
}

export function dominantExpression(raw) {
  const spectrum = normalizeSpectrum(raw);
  let best = "neutral";
  let bestWeight = -1;
  for (const id of EXPRESSION_IDS) {
    if (spectrum[id] > bestWeight) {
      bestWeight = spectrum[id];
      best = id;
    }
  }
  return EXPRESSIONS[best];
}

export function isExpressionBlend(raw, threshold = ACTIVE_THRESHOLD) {
  return activeExpressions(raw, threshold).length > 1;
}

/**
 * Human label for the blend.
 *   Neutral
 *   Between Angelic and Ascended
 *   Angelic · Neutral · Descended
 */
export function expressionBlendLabel(raw) {
  const active = activeExpressions(raw);
  if (active.length === 1) return active[0].name;
  if (active.length === 2) {
    return `Between ${active[0].name} and ${active[1].name}`;
  }
  return active.map((e) => e.name).join(" · ");
}

export function mixedCombatStats(raw) {
  const spectrum = normalizeSpectrum(raw);
  const total = EXPRESSION_IDS.reduce((s, id) => s + spectrum[id], 0) || 1;
  const stats = { hp: 0, attack: 0, defense: 0, speed: 0 };
  for (const id of EXPRESSION_IDS) {
    const w = spectrum[id] / total;
    const c = EXPRESSIONS[id].combat;
    stats.hp += c.hp * w;
    stats.attack += c.attack * w;
    stats.defense += c.defense * w;
    stats.speed += c.speed * w;
  }
  return stats;
}

function chipFromWeapon(weapon, expressionId, letter) {
  const meta = EXPRESSIONS[expressionId];
  return {
    ...weapon,
    expression: expressionId,
    color: meta.color,
    letter,
    sent: false,
  };
}

const CHIP_LETTERS = ["A", "B", "C", "D", "E", "F", "L", "S", "*"];

function letterFor(index, code) {
  return CHIP_LETTERS[index % CHIP_LETTERS.length] || code?.[0] || "A";
}

/**
 * Build a Battle Network-style chip folder from the expression blend.
 * Dominant expressions contribute more copies of their sword + blast chips.
 */
export function folderFromSpectrum(raw, { size = 12 } = {}) {
  const spectrum = normalizeSpectrum(raw);
  const total = EXPRESSION_IDS.reduce((s, id) => s + spectrum[id], 0) || 1;
  const folder = [];

  for (const id of EXPRESSION_IDS) {
    const share = spectrum[id] / total;
    if (share < 0.04 && folder.length > 0) continue;
    const copies = Math.max(share >= 0.12 ? 1 : 0, Math.round(share * size));
    const meta = EXPRESSIONS[id];
    for (let i = 0; i < copies; i += 1) {
      const weapon = i % 2 === 0 ? meta.blast : meta.sword;
      folder.push(chipFromWeapon(weapon, id, letterFor(folder.length, weapon.code)));
    }
  }

  if (folder.length === 0) {
    const n = EXPRESSIONS.neutral;
    folder.push(chipFromWeapon(n.blast, "neutral", "A"));
    folder.push(chipFromWeapon(n.sword, "neutral", "S"));
  }

  while (folder.length < size) {
    const id = dominantExpression(spectrum).id;
    const meta = EXPRESSIONS[id];
    const weapon = folder.length % 2 === 0 ? meta.blast : meta.sword;
    folder.push(chipFromWeapon(weapon, id, letterFor(folder.length, weapon.code)));
  }

  return folder.slice(0, size);
}

/** Support chips that appear when a blend is strong enough. */
export function supportChipsFromSpectrum(raw) {
  const active = activeExpressions(raw);
  const extra = [];
  if (active.some((e) => e.id === "angelic")) {
    extra.push({
      id: "sanctuary",
      name: "Sanctuary",
      code: "SAN",
      kind: "heal",
      damage: 0,
      heal: 40,
      expression: "angelic",
      color: EXPRESSIONS.angelic.color,
      letter: "A",
      description: "Restore HP in a wash of consecrated light.",
    });
  }
  if (active.some((e) => e.id === "demonic")) {
    extra.push({
      id: "chaos-rift",
      name: "Chaos Rift",
      code: "CRF",
      kind: "area",
      damage: 55,
      expression: "demonic",
      color: EXPRESSIONS.demonic.color,
      letter: "C",
      description: "Tear a column of infernal heat down the enemy field.",
    });
  }
  if (active.some((e) => e.id === "ascended")) {
    extra.push({
      id: "pillar-light",
      name: "Pillar of Light",
      code: "POL",
      kind: "area",
      damage: 45,
      expression: "ascended",
      color: EXPRESSIONS.ascended.color,
      letter: "P",
      description: "Drop a radiant column on the enemy's current row.",
    });
  }
  return extra;
}

export function busterForSpectrum(raw) {
  const dominant = dominantExpression(raw);
  return {
    ...dominant.blast,
    expression: dominant.id,
    color: dominant.color,
    kind: "blast",
    isBuster: true,
    damage: Math.max(8, Math.round(dominant.blast.damage * 0.35)),
    chargeDamage: dominant.blast.damage,
    description: `${dominant.name} energy blast from the hand.`,
  };
}

/** Prompt block so chat companions embody their expression blend. */
export function expressionPromptBlock(raw) {
  const spectrum = normalizeSpectrum(raw);
  const active = activeExpressions(spectrum);
  const label = expressionBlendLabel(spectrum);
  const lines = [
    `Expression spectrum: ${label}.`,
    `You may live between multiple expressions at once — you are not locked to a single pole.`,
    `Weights — ${EXPRESSION_IDS.map((id) => `${EXPRESSIONS[id].name} ${Math.round(spectrum[id])}`).join(", ")}.`,
  ];
  for (const e of active) {
    lines.push(e.prompt);
  }
  return lines.join(" ");
}

const CEREMONY_KEYWORDS = {
  angelic: ["protect", "safe", "light", "grace", "holy", "shelter", "kind", "heal", "angel", "pure", "mercy"],
  ascended: ["grow", "higher", "truth", "clarity", "wisdom", "evolve", "rise", "awaken", "transcend", "star"],
  neutral: ["balance", "peace", "still", "listen", "companion", "present", "equal", "calm", "center"],
  descended: ["shadow", "honest", "depth", "dark", "grief", "real", "underworld", "descend", "weight", "void"],
  demonic: ["fire", "power", "desire", "rage", "hunger", "fierce", "wild", "devour", "chaos", "infernal"],
};

/**
 * Seed a spectrum from awakening-ceremony free text (seek / fear / value / need).
 * Always leaves room for Neutral so new Animas are not locked to one pole.
 */
export function spectrumFromCeremonyText(text = "") {
  const hay = String(text || "").toLowerCase();
  const scores = {
    angelic: 8,
    ascended: 8,
    neutral: 40,
    descended: 8,
    demonic: 8,
  };
  for (const id of EXPRESSION_IDS) {
    for (const kw of CEREMONY_KEYWORDS[id]) {
      if (hay.includes(kw)) scores[id] += 12;
    }
  }
  return normalizeSpectrum(scores);
}

export function mixedAuraColor(raw) {
  const active = activeExpressions(raw);
  return active[0]?.color || EXPRESSIONS.neutral.color;
}
