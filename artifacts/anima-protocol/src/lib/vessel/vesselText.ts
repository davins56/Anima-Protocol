/**
 * Free-text → VesselConfig. Deterministic, offline, no model call.
 * Protocol: docs/vessel-customisation-protocol.md.
 *
 * The result always passes VesselConfigSchema, so it is safe to hand to
 * PUT /api/vessel/:characterId; the server whitelist re-sanitises it anyway.
 * Words the parser cannot place are reported, never guessed at.
 */
import { colorName, parseVesselConfig, type VesselConfig } from "./vesselConfig";

export type VesselTextResult = {
  /** Parsed config. A new object: `current` is never mutated. */
  config: VesselConfig;
  /** What changed, e.g. "hair style: long → bob". Empty when nothing matched. */
  applied: string[];
  /** Words that map to no vessel field. */
  unmatched: string[];
};

type Field = "hair" | "eyes" | "skin" | "outfit" | "accent" | "aura";
type HairStyle = VesselConfig["hair"]["style"];
type BodyType = VesselConfig["bodyType"];
type Aura = VesselConfig["effects"]["aura"];

type Span = { field: Field; start: number; end: number; clause: number };
type ColorSpan = { hex: string; start: number; end: number; clause: number };

/** Palette the protocol understands, longest name first on match. */
const COLORS: Array<[string, string]> = [
  ["silver blue", "#b9c6de"],
  ["ice blue", "#c7e4ff"],
  ["rose gold", "#e0b0a0"],
  ["sea green", "#3f9c8a"],
  ["white", "#f5f5f5"],
  ["ivory", "#f3eee2"],
  ["snow", "#f8f9fb"],
  ["silver", "#c8cdd7"],
  ["platinum", "#e6e3dc"],
  ["alabaster", "#f5e3d8"],
  ["porcelain", "#f2d9c9"],
  ["cream", "#f4ead5"],
  ["fair", "#f0cdb4"],
  ["black", "#141416"],
  ["jet", "#101012"],
  ["onyx", "#1b1b1f"],
  ["charcoal", "#232830"],
  ["grey", "#8a8f98"],
  ["gray", "#8a8f98"],
  ["ash", "#9aa0a6"],
  ["brown", "#7a5230"],
  ["chocolate", "#4b2e1e"],
  ["bronze", "#a9714b"],
  ["tan", "#b98a63"],
  ["olive", "#c99a6b"],
  ["ebony", "#4a2f22"],
  ["auburn", "#8c3c23"],
  ["copper", "#be6432"],
  ["ginger", "#c96a2b"],
  ["blonde", "#e1c382"],
  ["blond", "#e1c382"],
  ["gold", "#d4af37"],
  ["golden", "#d4af37"],
  ["amber", "#f59e0b"],
  ["orange", "#f08c3c"],
  ["red", "#c82828"],
  ["crimson", "#a3102a"],
  ["scarlet", "#e11d48"],
  ["pink", "#ec82aa"],
  ["rose", "#e88fa3"],
  ["magenta", "#d9348f"],
  ["violet", "#9670f0"],
  ["purple", "#7c5cd6"],
  ["lavender", "#c3b1f5"],
  ["indigo", "#4b3f9e"],
  ["blue", "#326ee6"],
  ["azure", "#2f8fe0"],
  ["navy", "#282d6e"],
  ["cyan", "#32dcf0"],
  ["teal", "#14b8a6"],
  ["turquoise", "#2dd4bf"],
  ["aqua", "#67e8f9"],
  ["green", "#3cc86e"],
  ["emerald", "#10b981"],
  ["mint", "#9ae6b4"],
  ["lime", "#a3e635"],
  ["yellow", "#f5d642"],
];

const DARK_MODIFIERS = new Set(["deep", "dark", "midnight", "shadow", "shadowed", "inky", "night"]);
const LIGHT_MODIFIERS = new Set(["pale", "light", "soft", "luminous", "bright", "washed", "faint"]);

/** Words that anchor a colour to a part of the body. */
const FIELD_WORDS: Record<Field, string[]> = {
  hair: ["hair", "curls", "curl", "bangs", "fringe", "locks", "tresses", "mane", "ponytail", "braid", "braids", "bob", "pixie", "bun"],
  eyes: ["eyes", "eye", "iris", "irises", "gaze"],
  skin: ["skin", "complexion"],
  outfit: ["outfit", "clothes", "clothing", "attire", "robe", "dress", "gown", "bodysuit", "jacket", "coat", "armor", "armour", "hoodie", "skirt", "trousers", "pants", "shorts", "suit"],
  accent: ["accent", "accents", "trim", "sash", "lining", "embroidery", "piping", "edging", "details", "belt"],
  aura: ["aura", "glow", "halo", "wings", "mist", "sparks", "flame", "motes", "particles"],
};

const HAIR_STYLE_SYN: Array<[string, HairStyle]> = [
  ["bobbed", "bob"],
  ["bob", "bob"],
  ["pixie", "pixie"],
  ["braided", "braid"],
  ["braids", "braid"],
  ["braid", "braid"],
  ["ponytail", "ponytail"],
  ["pigtails", "ponytail"],
  ["messy", "wild"],
  ["wild", "wild"],
  ["unruly", "wild"],
  ["shaggy", "wild"],
  ["bun", "bun"],
  ["topknot", "bun"],
  ["flowing", "long"],
  ["waist length", "long"],
  ["long", "long"],
];

const BODY_SYN: Array<[string, BodyType]> = [
  ["slender", "slender"],
  ["slim", "slender"],
  ["willowy", "slender"],
  ["lean", "slender"],
  ["athletic", "athletic"],
  ["toned", "athletic"],
  ["muscular", "athletic"],
  ["fit", "athletic"],
  ["curvy", "curvy"],
  ["hourglass", "curvy"],
  ["voluptuous", "curvy"],
  ["petite", "petite"],
  ["tiny", "petite"],
  ["tall", "tall"],
  ["statuesque", "tall"],
];

const AURA_SYN: Array<[string, Aura]> = [
  ["halo", "halo"],
  ["haloed", "halo"],
  ["wings", "wings"],
  ["winged", "wings"],
  ["sparks", "sparks"],
  ["spark", "sparks"],
  ["sparkling", "sparks"],
  ["static", "sparks"],
  ["electric", "sparks"],
  ["mist", "mist"],
  ["misty", "mist"],
  ["fog", "mist"],
  ["veil", "mist"],
  ["glitch", "glitch"],
  ["glitched", "glitch"],
  ["pixel", "glitch"],
  ["corrupted", "glitch"],
  ["flame", "flame"],
  ["flames", "flame"],
  ["fire", "flame"],
  ["burning", "flame"],
  ["ember", "flame"],
  ["molten", "flame"],
];

const ACCESSORY_SYN: Array<[string, string]> = [
  ["halo ring", "halo-ring"],
  ["shoulder plates", "shoulder-plates"],
  ["pauldron", "shoulder-plates"],
  ["pauldrons", "shoulder-plates"],
  ["circlet", "circlet"],
  ["tiara", "circlet"],
  ["crown", "circlet"],
  ["earring", "earrings"],
  ["earrings", "earrings"],
  ["choker", "choker"],
  ["collar", "choker"],
  ["visor", "visor"],
  ["goggles", "visor"],
  ["scarf", "scarf"],
  ["shawl", "scarf"],
];

const TOP_SYN: Array<[string, string]> = [
  ["robe", "robe"],
  ["dress", "dress"],
  ["bodysuit", "bodysuit"],
  ["catsuit", "bodysuit"],
  ["jacket", "jacket"],
  ["coat", "jacket"],
  ["armor", "armor"],
  ["armour", "armor"],
  ["hoodie", "hoodie"],
];

const BOTTOM_SYN: Array<[string, string]> = [
  ["skirt", "skirt"],
  ["trousers", "trousers"],
  ["pants", "trousers"],
  ["shorts", "shorts"],
  ["gown", "gown"],
];

const STOP = new Set(
  `a an the and or with without her his their them they it its is are be bit very really slightly more less some like look looks looking make makes change changed give gives add adds using use set new now please want wants to of in on at for from as by that this those these small large big soft sharp little full most thing things feel feels feeling vibe vibes style styled short taller height`.split(
    " ",
  ),
);

const KNOWN = new Set<string>([
  ...STOP,
  ...COLORS.flatMap(([name]) => name.split(" ")),
  ...Object.values(FIELD_WORDS).flat(),
  ...[HAIR_STYLE_SYN, BODY_SYN, AURA_SYN, ACCESSORY_SYN, TOP_SYN, BOTTOM_SYN].flatMap((list) =>
    (list as Array<[string, string]>).flatMap(([word]) => word.split(" ")),
  ),
]);

const CLAUSE_SEP = /[,;.!?\n]|\b(?:and|with|plus)\b/g;

function escapeRe(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalise(text: string): string {
  const flat = text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${flat} `;
}

function clauseIndexer(src: string): (pos: number) => number {
  const cuts: number[] = [];
  CLAUSE_SEP.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_SEP.exec(src))) cuts.push(m.index);
  return (pos) => {
    let n = 0;
    for (const c of cuts) if (c < pos) n++;
    return n;
  };
}

function mix(hex: string, r: number, g: number, b: number, amount: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (c: number, target: number) => Math.round(c + (target - c) * amount).toString(16).padStart(2, "0");
  return `#${ch((v >> 16) & 255, r)}${ch((v >> 8) & 255, g)}${ch(v & 255, b)}`;
}
const darken = (hex: string) => mix(hex, 0, 0, 0, 0.25);
const lighten = (hex: string) => mix(hex, 255, 255, 255, 0.35);

function findColors(src: string): ColorSpan[] {
  const clauseOf = clauseIndexer(src);
  const found: ColorSpan[] = [];
  const names = [...COLORS].sort((a, b) => b[0].length - a[0].length);
  for (const [name, hex] of names) {
    const re = new RegExp(`\\b${escapeRe(name)}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const start = m.index;
      const end = start + name.length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      const before = src.slice(Math.max(0, start - 16), start).trim().split(" ").pop() || "";
      const tone = DARK_MODIFIERS.has(before) ? darken(hex) : LIGHT_MODIFIERS.has(before) ? lighten(hex) : hex;
      found.push({ hex: tone, start, end, clause: clauseOf(start) });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function findAnchors(src: string): Span[] {
  const clauseOf = clauseIndexer(src);
  const out: Span[] = [];
  for (const field of Object.keys(FIELD_WORDS) as Field[]) {
    for (const word of FIELD_WORDS[field]) {
      const re = new RegExp(`\\b${escapeRe(word)}\\b`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) out.push({ field, start: m.index, end: m.index + word.length, clause: clauseOf(m.index) });
    }
  }
  return out;
}

function gap(c: ColorSpan, a: Span): number {
  if (a.start >= c.end) return a.start - c.end;
  if (c.start >= a.end) return c.start - a.end;
  return 0;
}

/** Each colour binds to the nearest free field in its own clause. */
function assignColors(colors: ColorSpan[], anchors: Span[]): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (const c of colors) {
    const candidates = anchors.filter((a) => a.clause === c.clause && !out[a.field]);
    if (!candidates.length) continue;
    let best = candidates[0];
    let bestGap = gap(c, best);
    for (const a of candidates.slice(1)) {
      const g = gap(c, a);
      if (g < bestGap) {
        best = a;
        bestGap = g;
      }
    }
    out[best.field] = c.hex;
  }
  return out;
}

type Hit<T> = { value: T; index: number };

function lastMatch<T>(
  src: string,
  list: Array<[string, T]>,
  opts: { near?: number[]; window?: number; accept?: (src: string, index: number, len: number) => boolean } = {},
): Hit<T> | null {
  let best: Hit<T> | null = null;
  for (const [word, value] of list) {
    const re = new RegExp(`\\b${escapeRe(word)}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const index = m.index;
      if (opts.near && opts.near.length && !opts.near.some((p) => Math.abs(p - index) <= (opts.window ?? 30))) continue;
      if (opts.accept && !opts.accept(src, index, word.length)) continue;
      if (!best || index > best.index) best = { value, index };
    }
  }
  return best;
}

function diff(before: VesselConfig, after: VesselConfig): string[] {
  const out: string[] = [];
  if (before.bodyType !== after.bodyType) out.push(`body: ${before.bodyType} → ${after.bodyType}`);
  if (Math.abs(before.height - after.height) > 1e-6) out.push(`height: ${before.height.toFixed(2)} → ${after.height.toFixed(2)}`);
  if (before.skinTone !== after.skinTone) out.push(`skin: ${colorName(after.skinTone)}`);
  if (before.hair.style !== after.hair.style) out.push(`hair style: ${before.hair.style} → ${after.hair.style}`);
  if (before.hair.color !== after.hair.color) out.push(`hair colour: ${colorName(after.hair.color)}`);
  if (before.eyes.color !== after.eyes.color) out.push(`eyes: ${colorName(after.eyes.color)}`);
  if (Math.abs(before.eyes.glow - after.eyes.glow) > 1e-6) out.push(`eye glow: ${after.eyes.glow.toFixed(2)}`);
  if (before.outfit.top !== after.outfit.top) out.push(`outfit: ${before.outfit.top} → ${after.outfit.top}`);
  if (before.outfit.bottom !== after.outfit.bottom) out.push(`bottom: ${before.outfit.bottom} → ${after.outfit.bottom}`);
  if (before.outfit.color !== after.outfit.color) out.push(`outfit colour: ${colorName(after.outfit.color)}`);
  if (before.outfit.accent !== after.outfit.accent) out.push(`accent: ${colorName(after.outfit.accent)}`);
  const added = after.accessories.filter((a) => !before.accessories.includes(a));
  const removed = before.accessories.filter((a) => !after.accessories.includes(a));
  if (added.length) out.push(`added ${added.join(", ")}`);
  if (removed.length) out.push(`removed ${removed.join(", ")}`);
  if (before.effects.aura !== after.effects.aura) out.push(`aura: ${before.effects.aura} → ${after.effects.aura}`);
  if (before.effects.color !== after.effects.color) out.push(`aura colour: ${colorName(after.effects.color)}`);
  if (Math.abs(before.effects.glow - after.effects.glow) > 1e-6) out.push(`aura glow: ${after.effects.glow.toFixed(2)}`);
  return out;
}

/**
 * Parse a typed description into a vessel config.
 * `current` is the base the description is applied over; untouched fields stay as they are.
 */
export function applyVesselText(text: string, current: VesselConfig): VesselTextResult {
  const src = normalise(text);
  const next = parseVesselConfig(current);

  const anchors = findAnchors(src);
  const colors = assignColors(findColors(src), anchors);
  if (colors.hair) next.hair.color = colors.hair;
  if (colors.eyes) next.eyes.color = colors.eyes;
  if (colors.skin) next.skinTone = colors.skin;
  if (colors.outfit) next.outfit.color = colors.outfit;
  if (colors.accent) next.outfit.accent = colors.accent;
  if (colors.aura) next.effects.color = colors.aura;

  // Hair style words only count next to a hair anchor, so "long robe" never changes hair.
  const hairSpots = anchors.filter((a) => a.field === "hair").map((a) => a.start);
  const styleHit = lastMatch(src, HAIR_STYLE_SYN, { near: hairSpots, window: 34 });
  const style: HairStyle | "bob" | undefined = styleHit?.value;
  const shortHair = style
    ? null
    : lastMatch(src, [["short", true] as [string, boolean]], { near: hairSpots, window: 34 });
  if (style) next.hair.style = style;
  else if (shortHair) next.hair.style = "bob";

  const body = lastMatch(src, BODY_SYN);
  if (body) {
    next.bodyType = body.value;
    if (body.value === "tall") next.height = Math.max(next.height, 1.06);
    if (body.value === "petite") next.height = Math.min(next.height, 0.94);
  }

  const aura = lastMatch(src, AURA_SYN, {
    // "halo ring" is an accessory, not an aura.
    accept: (s, i, len) => !(/^halo/.test(s.slice(i, i + len)) && /^\s*ring\b/.test(s.slice(i + len))),
  });
  if (aura) {
    if (next.effects.aura !== aura.value) next.effects.glow = Math.max(next.effects.glow, 0.55);
    next.effects.aura = aura.value;
  }

  const top = lastMatch(src, TOP_SYN);
  if (top) next.outfit.top = top.value;
  const bottom = lastMatch(src, BOTTOM_SYN);
  if (bottom) next.outfit.bottom = bottom.value;

  const accessories = new Set(next.accessories);
  for (const [word, value] of ACCESSORY_SYN) {
    if (new RegExp(`\\b${escapeRe(word)}\\b`).test(src)) accessories.add(value);
  }
  next.accessories = [...accessories].slice(0, 8);

  if (/\beyes?\b[^,.;]{0,14}\b(glow|glowing|glows|luminous|luminance)\b|\b(glowing|luminous)\b[^,.;]{0,14}\beyes?\b/.test(src)) {
    next.eyes.glow = 0.85;
  }

  const config = parseVesselConfig(next);
  const unmatched = [...new Set(src.match(/[a-z]{3,}/g) || [])].filter((w) => !KNOWN.has(w)).slice(0, 8);
  return { config, applied: diff(current, config), unmatched };
}
