/**
 * Deterministic trait → style selection (§4).
 *
 * Reproducibility (Serenity's note on #768): the result depends only on the
 * character's own inputs, the stable style ids, the library version and an
 * explicit selection seed `fnv1a(characterId | library_version)`. Ties break
 * on `fnv1a(seed | style_id)`, never on object order or Math.random. The
 * re-roll counter only chooses which of the top five is primary.
 *
 * User-written text is untrusted data: it is only tokenised and counted
 * against fixed word lists and style aliases. It can never supply a rule,
 * a modifier or a style id.
 */
import { fnv1a, fnv1aHex } from "./hash";
import { ARCHETYPE_BONUS, BASELINE_BONUS, SPECTRUM_BONUS, WORD_AXES, words } from "./lexicon";
import { getStyle, type MartialLibrary } from "./library";
import { AXES, type Axis, type AxisVector, type MartialStyle, type MartialVariant, type PersonalityInputs, type StylePick } from "./types";

export const CANON_BONUS = 40;
export const RANKING_SIZE = 5;
export const SECONDARY_RATIO = 0.75;
export const BACKSTORY_MAX = 2000;
/** Empty personality falls back to a hash pick from these generalists (§4.6). */
export const GENERALISTS: readonly StylePick[] = [
  { style_id: "boxing", variant_id: null },
  { style_id: "judo", variant_id: null },
  { style_id: "karate", variant_id: "shotokan" },
  { style_id: "muay_thai", variant_id: null },
  { style_id: "eskrima", variant_id: null },
];

/** Extra aliases for canon detection ("former boxer", "kali sticks"). Names and ids are added automatically. */
const EXTRA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  boxing: ["boxer", "prizefighter"],
  muay_thai: ["thai boxing", "nak muay"],
  kickboxing: ["kickboxer"],
  taekwondo: ["tae kwon do"],
  karate: ["karateka", "shotokan", "kyokushin", "goju ryu"],
  wing_chun: ["wing tsun", "ving tsun"],
  taijiquan: ["tai chi", "taiji", "tai chi chuan"],
  bjj: ["brazilian jiu jitsu", "jiu jitsu"],
  judo: ["judoka"],
  wrestling: ["wrestler"],
  sambo: ["sambist"],
  sumo: ["sumotori", "rikishi"],
  mma: ["mixed martial artist", "cage fighter"],
  capoeira: ["capoeirista"],
  silat: ["pencak silat", "silek"],
  eskrima: ["escrima", "kali", "arnis", "kali sticks"],
  kendo: ["kendoka"],
  kyudo: ["japanese archery"],
  fencing: ["fencer"],
  hema: ["longsword"],
  jujutsu: ["jujitsu"],
  baguazhang: ["bagua"],
  xingyiquan: ["xingyi", "hsing i"],
  mantis: ["mantis kung fu"],
  changquan: ["long fist"],
};
/** Name fragments that are too generic to count as a canon mention. */
const ALIAS_STOP = new Set(["modern", "sport", "arts", "fighting", "style"]);

export type RankedStyle = { style_id: string; variant_id: string | null; score: number };

export type Choice = {
  primary: StylePick;
  secondary: StylePick | null;
  /** top five, scores rounded to integers (API shape) */
  ranking: RankedStyle[];
  reason_axes: Axis[];
  inputs_hash: string;
  selection_seed: number;
  library_version: string;
  roll: number;
};

function asText(v: unknown, max = 4000): string {
  if (typeof v === "string") return v.slice(0, max);
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(" ").slice(0, max);
  return "";
}

function zero(): AxisVector {
  const v = {} as AxisVector;
  for (const a of AXES) v[a] = 0;
  return v;
}

function addBonus(v: AxisVector, bonus: Partial<Record<Axis, number>> | undefined, scale = 1) {
  if (!bonus) return;
  for (const [axis, n] of Object.entries(bonus) as [Axis, number][]) v[axis] += n * scale;
}

function personalityText(inputs: PersonalityInputs): string {
  return [
    asText(inputs.personality),
    asText(inputs.speaking_style),
    asText(inputs.backstory, BACKSTORY_MAX),
    asText(inputs.tagline),
    asText(inputs.traits),
  ].join(" ");
}

/** §4 step 1: the ten-axis trait vector from this character's own fields. */
export function traitVector(inputs: PersonalityInputs): AxisVector {
  const v = zero();
  const counts = new Map<string, number>();
  for (const w of words(personalityText(inputs))) {
    const axes = WORD_AXES.get(w);
    if (!axes) continue;
    const c = counts.get(w) ?? 0;
    if (c >= 2) continue;
    counts.set(w, c + 1);
    for (const a of axes) v[a] += 1;
  }
  const archetype = typeof inputs.archetype === "string" ? inputs.archetype.trim().toLowerCase() : "";
  addBonus(v, ARCHETYPE_BONUS[archetype]);
  const spectrum = inputs.expression_spectrum;
  if (spectrum && typeof spectrum === "object" && !Array.isArray(spectrum)) {
    const s = spectrum as Record<string, unknown>;
    const num = (k: string) => (typeof s[k] === "number" && Number.isFinite(s[k]) && (s[k] as number) > 0 ? (s[k] as number) : 0);
    const total = ["angelic", "ascended", "neutral", "descended", "demonic"].reduce((t, k) => t + num(k), 0);
    if (total > 0) for (const k of Object.keys(SPECTRUM_BONUS)) addBonus(v, SPECTRUM_BONUS[k], num(k) / total);
  }
  const family = typeof inputs.baseline_family === "string" ? inputs.baseline_family.trim().toLowerCase() : "";
  addBonus(v, BASELINE_BONUS[family]);
  return v;
}

function isZero(v: AxisVector): boolean {
  return AXES.every((a) => v[a] === 0);
}

function cosine(a: AxisVector, b: AxisVector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of AXES) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function aliasesFor(style: MartialStyle): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const phrase = words(s).join(" ");
    if (phrase.length >= 3 && !ALIAS_STOP.has(phrase)) out.add(phrase);
  };
  add(style.id.replace(/_/g, " "));
  for (const part of style.name.split(/[/()]/)) add(part);
  for (const a of EXTRA_ALIASES[style.id] ?? []) add(a);
  return [...out];
}

/** §4 step 2: styles explicitly named in her written personality or history. */
export function canonMentions(inputs: PersonalityInputs, lib: MartialLibrary): Set<string> {
  const hay = ` ${words([asText(inputs.personality), asText(inputs.backstory, BACKSTORY_MAX), asText(inputs.traits), asText(inputs.tagline)].join(" ")).join(" ")} `;
  const hits = new Set<string>();
  if (hay.trim() === "") return hits;
  for (const style of lib.styles) {
    if (aliasesFor(style).some((a) => hay.includes(` ${a} `))) hits.add(style.id);
  }
  return hits;
}

export function selectionSeed(characterId: string, libraryVersion: string): number {
  return fnv1a(`${characterId}|${libraryVersion}`);
}

function withTilt(style: MartialStyle, variant: MartialVariant | null): AxisVector {
  const v = { ...style.axes };
  if (variant) for (const [k, n] of Object.entries(variant.tilt) as [Axis, number][]) v[k] += n;
  return v;
}

/** §4 step 4: the best variant by dot product with its tilt (ties: catalog order). */
export function bestVariant(style: MartialStyle, trait: AxisVector, seed: number): string | null {
  if (!style.variants.length) return null;
  if (isZero(trait)) return style.variants[fnv1a(`${seed}|${style.id}|variant`) % style.variants.length].id;
  let best = style.variants[0];
  let bestScore = -Infinity;
  for (const variant of style.variants) {
    const t = withTilt(style, variant);
    let dot = 0;
    for (const a of AXES) dot += t[a] * trait[a];
    if (dot > bestScore) {
      best = variant;
      bestScore = dot;
    }
  }
  return best.id;
}

/** Full ordered ranking (unrounded scores). */
export function rankStyles(inputs: PersonalityInputs, characterId: string, lib: MartialLibrary): RankedStyle[] {
  const trait = traitVector(inputs);
  const seed = selectionSeed(characterId, lib.version);
  const canon = canonMentions(inputs, lib);
  const tie = (id: string) => fnv1a(`${seed}|${id}`);
  if (isZero(trait) && canon.size === 0) {
    return GENERALISTS.filter((g) => lib.byId.has(g.style_id))
      .map((g) => ({ ...g, score: 0, t: tie(g.style_id) }))
      .sort((a, b) => a.t - b.t)
      .map(({ style_id, variant_id }) => {
        const style = lib.byId.get(style_id) as MartialStyle;
        return { style_id, variant_id: variant_id ?? bestVariant(style, trait, seed), score: 0 };
      });
  }
  return lib.styles
    .map((style) => ({
      style_id: style.id,
      variant_id: bestVariant(style, trait, seed),
      score: cosine(trait, style.axes) * 100 + (canon.has(style.id) ? CANON_BONUS : 0),
      t: tie(style.id),
      c: canon.has(style.id) ? 1 : 0,
    }))
    // Explicit canon wins (§4.2): a style named in her history ranks ahead of
    // unnamed ones, then by score (which also carries the +40), then the seeded tie-break.
    .sort((a, b) => b.c - a.c || b.score - a.score || a.t - b.t || (a.style_id < b.style_id ? -1 : 1))
    .map(({ style_id, variant_id, score }) => ({ style_id, variant_id, score }));
}

/** §4 step 5: best style of a DIFFERENT kind scoring ≥ 0.75 × primary, else null. */
export function pickSecondary(ranking: RankedStyle[], primary: RankedStyle, lib: MartialLibrary): StylePick | null {
  const kind = lib.byId.get(primary.style_id)?.kind;
  if (!kind || primary.score <= 0) return null;
  const found = ranking.find((r) => r.style_id !== primary.style_id && lib.byId.get(r.style_id)?.kind !== kind && r.score >= SECONDARY_RATIO * primary.score);
  return found ? { style_id: found.style_id, variant_id: found.variant_id } : null;
}

/** Top axes behind the pick: where her traits and the style's weights overlap. */
export function reasonAxes(trait: AxisVector, style: MartialStyle | null): Axis[] {
  if (!style) return [];
  return AXES.map((a) => ({ a, w: trait[a] * style.axes[a] }))
    .filter((x) => x.w > 0)
    .sort((x, y) => y.w - x.w || AXES.indexOf(x.a) - AXES.indexOf(y.a))
    .slice(0, 2)
    .map((x) => x.a);
}

function stableInputs(inputs: PersonalityInputs): string {
  return JSON.stringify([
    asText(inputs.personality),
    asText(inputs.speaking_style),
    asText(inputs.backstory, BACKSTORY_MAX),
    asText(inputs.tagline),
    asText(inputs.traits),
    typeof inputs.archetype === "string" ? inputs.archetype : "",
    inputs.expression_spectrum && typeof inputs.expression_spectrum === "object"
      ? Object.entries(inputs.expression_spectrum as Record<string, unknown>)
          .filter(([, n]) => typeof n === "number")
          .sort(([a], [b]) => (a < b ? -1 : 1))
      : [],
    typeof inputs.baseline_family === "string" ? inputs.baseline_family : "",
  ]);
}

export function inputsHash(inputs: PersonalityInputs): string {
  return fnv1aHex(stableInputs(inputs));
}

/**
 * §4: choose primary, variant and secondary. `roll` re-rolls among her five
 * best fits (`ranking[roll mod 5]`), so a re-roll stays personality-consistent.
 */
export function chooseStyle(args: { inputs: PersonalityInputs; characterId: string; lib: MartialLibrary; roll?: number }): Choice {
  const { inputs, characterId, lib } = args;
  const roll = Math.max(0, Math.floor(Number.isFinite(args.roll) ? (args.roll as number) : 0));
  const full = rankStyles(inputs, characterId, lib);
  const top = full.slice(0, RANKING_SIZE);
  const primaryRanked = top[roll % Math.max(1, top.length)];
  const primary = { style_id: primaryRanked.style_id, variant_id: primaryRanked.variant_id };
  const trait = traitVector(inputs);
  return {
    primary,
    secondary: pickSecondary(full, primaryRanked, lib),
    ranking: top.map((r) => ({ ...r, score: Math.round(r.score) })),
    reason_axes: reasonAxes(trait, getStyle(lib, primary.style_id)),
    inputs_hash: inputsHash(inputs),
    selection_seed: selectionSeed(characterId, lib.version),
    library_version: lib.version,
    roll,
  };
}

/** §4.10: personality edited since the pick → the UI offers "Ask her again". */
export function isStale(profile: { inputs_hash?: unknown } | null | undefined, inputs: PersonalityInputs): boolean {
  return !!profile && typeof profile.inputs_hash === "string" && profile.inputs_hash !== inputsHash(inputs);
}
