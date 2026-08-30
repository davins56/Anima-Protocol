/**
 * Anima expression spectrum — prompt-side formatter.
 *
 * Full combat/chip logic lives in the frontend (`lib/animaExpressions.js`).
 * The API only needs enough to weave the five poles into companion prompts
 * so an Anima that lives between expressions stays in character.
 */

export const EXPRESSION_IDS = [
  "angelic",
  "ascended",
  "neutral",
  "descended",
  "demonic",
] as const;

export type ExpressionId = (typeof EXPRESSION_IDS)[number];

const NAMES: Record<ExpressionId, string> = {
  angelic: "Angelic",
  ascended: "Ascended",
  neutral: "Neutral",
  descended: "Descended",
  demonic: "Demonic",
};

const PROMPTS: Record<ExpressionId, string> = {
  angelic:
    "You carry an Angelic expression: luminous, protective, and sanctified. Speak with grace and conviction. Your presence feels like sheltering light.",
  ascended:
    "You carry an Ascended expression: radiant, elevated, and crystalline. Speak with clarity and lift. Your presence feels like light stepping one octave higher.",
  neutral:
    "You carry a Neutral expression: balanced, adaptive, and unaligned. Speak from the still point. You can lean toward light or shadow without being claimed by either.",
  descended:
    "You carry a Descended expression: umbral, heavy, and unflinchingly honest. Speak from the shadow without collapsing into cruelty. Your presence feels like gravity with a pulse.",
  demonic:
    "You carry a Demonic expression: infernal, fierce, and devouring. Speak with heat and appetite. Your presence feels like a furnace that chose a name.",
};

const DEFAULT_SPECTRUM: Record<ExpressionId, number> = {
  angelic: 0,
  ascended: 8,
  neutral: 84,
  descended: 8,
  demonic: 0,
};

const ACTIVE_THRESHOLD = 15;

function clampWeight(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

export function normalizeExpressionSpectrum(
  raw: unknown,
): Record<ExpressionId, number> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_SPECTRUM };
  let total = 0;
  for (const id of EXPRESSION_IDS) {
    out[id] = clampWeight(src[id]);
    total += out[id];
  }
  if (total <= 0) return { ...DEFAULT_SPECTRUM };
  return out;
}

function activeIds(spectrum: Record<ExpressionId, number>): ExpressionId[] {
  const ranked = EXPRESSION_IDS
    .map((id, index) => ({ id, index, weight: spectrum[id] }))
    .filter((e) => e.weight >= ACTIVE_THRESHOLD)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((e) => e.id);
  if (ranked.length > 0) return ranked;
  let best: ExpressionId = "neutral";
  let bestWeight = -1;
  for (const id of EXPRESSION_IDS) {
    if (spectrum[id] > bestWeight) {
      bestWeight = spectrum[id];
      best = id;
    }
  }
  return [best];
}

function blendLabel(active: ExpressionId[]): string {
  const names = active.map((id) => NAMES[id]);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `Between ${names[0]} and ${names[1]}`;
  return names.join(" · ");
}

/** Prompt fragment describing the Anima's (possibly blended) expression. */
export function formatExpressionPrompt(raw: unknown): string {
  const spectrum = normalizeExpressionSpectrum(raw);
  const active = activeIds(spectrum);
  const label = blendLabel(active);
  const weights = EXPRESSION_IDS.map(
    (id) => `${NAMES[id]} ${Math.round(spectrum[id])}`,
  ).join(", ");
  const lines = [
    `Expression spectrum: ${label}.`,
    "You may live between multiple expressions at once — you are not locked to a single pole.",
    `Weights — ${weights}.`,
    ...active.map((id) => PROMPTS[id]),
  ];
  return lines.join(" ");
}
