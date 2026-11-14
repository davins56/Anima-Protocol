/**
 * Body-plan facts for image prompts: how many arms, wings, tails, heads, eyes
 * or legs a character has, read from the text that already describes them
 * (appearance fields, card text, lore). Image models default to a human body
 * plan, so a four-armed character needs the count stated early, explicitly
 * and positively ("exactly four arms: two at the shoulders, two at the
 * ribcage"); FLUX ignores negative prompts on most of our endpoints.
 *
 * Deterministic, no model call. Only explicit quantities count ("four arms",
 * "four-armed", "a second pair of arms", "a third eye"); "in her arms" or
 * "arms crossed" never do.
 */

export type AnatomyPart = "arms" | "legs" | "wings" | "tails" | "heads" | "eyes";

export type AnatomySpec = {
  counts: Partial<Record<AnatomyPart, number>>;
  /** Horn count, only when the text gives one. */
  horns?: number;
};

export const ANATOMY_PARTS: AnatomyPart[] = ["arms", "legs", "wings", "tails", "heads", "eyes"];

/** What an unremarkable human has; a spec only matters where it differs. */
export const HUMAN_DEFAULTS: Record<AnatomyPart, number> = { arms: 2, legs: 2, wings: 0, tails: 0, heads: 1, eyes: 2 };

const NUMBER_WORDS: Record<string, number> = {
  one: 1, single: 1, two: 2, twin: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const WORD = "(\\d{1,2}|one|single|two|twin|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const MAX_COUNT = 12;

const PART_NOUN: Record<AnatomyPart, string> = {
  arms: "arms?",
  legs: "legs?",
  wings: "wings?",
  tails: "tails?",
  heads: "heads?",
  eyes: "eyes?",
};
const PART_ADJ: Record<AnatomyPart, string> = {
  arms: "armed",
  legs: "legged",
  wings: "winged",
  tails: "tailed",
  heads: "headed",
  eyes: "eyed",
};

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const k = raw.toLowerCase();
  const n = /^\d+$/.test(k) ? Number(k) : NUMBER_WORDS[k];
  return Number.isFinite(n) && n >= 1 && n <= MAX_COUNT ? n : null;
}

function clean(v: unknown): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f<>[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First explicit count for one part in one text, or null. */
export function countIn(text: string, part: AnatomyPart): number | null {
  const t = ` ${clean(text).toLowerCase()} `;
  const noun = PART_NOUN[part];
  const adj = PART_ADJ[part];
  // Explicit removal ("no wings", "without her tail", "wingless") is a count of zero,
  // so a customised look beats the lore or built-in default it overrides.
  if (part === "wings" || part === "tails") {
    const stem = part === "wings" ? "wing" : "tail";
    if (new RegExp(`\\b(?:no|without|never\\s+any)\\s+(?:[a-z]+\\s+){0,2}?${stem}s?\\b|\\b${stem}less\\b`).test(t)) return 0;
  }
  // "two pairs of arms", "three sets of wings"
  let m = new RegExp(`\\b${WORD}\\s+(?:pairs|sets)\\s+of\\s+(?:[a-z-]+\\s+){0,2}${noun}\\b`).exec(t);
  if (m && num(m[1])) return Math.min(MAX_COUNT, num(m[1])! * 2);
  // "an extra / a second / an additional pair of arms" → the usual pair plus one more
  if (part === "arms" || part === "legs") {
    m = new RegExp(`\\b(?:an?\\s+)?(?:extra|second|additional|another|lower|upper)\\s+(?:pair|set)\\s+of\\s+(?:[a-z-]+\\s+){0,2}${noun}\\b`).exec(t);
    if (m) return 4;
  }
  // "a pair of wings"
  m = new RegExp(`\\b(?:a|one)\\s+(?:pair|set)\\s+of\\s+(?:[a-z-]+\\s+){0,2}${noun}\\b`).exec(t);
  if (m) return 2;
  // "four arms", "4 arms", "four muscular arms". A count of one needs "only" /
  // "single" ("one arm around you" is a gesture, not anatomy).
  const plain = new RegExp(
    `\\b(only\\s+|just\\s+)?${WORD}[\\s-]+(?:[a-z]+[\\s-]+){0,2}?${noun}\\b(?!\\s+(?:of\\s+the|taller|shorter|above|below|away)\\b)`,
    "g",
  );
  for (const hit of t.matchAll(plain)) {
    const n = num(hit[2]);
    if (n && (n > 1 || hit[1] || hit[2].toLowerCase() === "single")) return n;
  }
  // "four-armed", "six armed", "two-headed"
  m = new RegExp(`\\b${WORD}[\\s-]${adj}\\b`).exec(t);
  if (m && num(m[1])) return num(m[1]);
  if (part === "eyes" && /\bthird eye\b/.test(t)) return 3;
  return null;
}

/** Bare mention without a number ("angelic wings", "her tail"). */
function mentions(text: string, part: "wings" | "tails"): boolean {
  const t = clean(text).toLowerCase();
  if (part === "wings") {
    return /\b(?:her|his|their|its|large|huge|great|feathered|feathery|angelic|bat|leathery|crystalline|dragon|butterfly|gossamer)\s+wings\b|\bhas\s+wings\b/.test(t);
  }
  return /\b(?:her|his|their|its|long|fluffy|lashing|swishing|fox|cat|dragon|demon|scaled|prehensile)\s+tail\b/.test(t);
}

/**
 * One spec from many texts in priority order: the first text that states a
 * count for a part wins, so Customise Anima fields beat card text beat lore.
 */
export function anatomyFrom(texts: Array<string | null | undefined>): AnatomySpec {
  const list = texts.map(clean).filter(Boolean);
  const counts: AnatomySpec["counts"] = {};
  for (const part of ANATOMY_PARTS) {
    for (const text of list) {
      const n = countIn(text, part);
      if (n != null) {
        counts[part] = n;
        break;
      }
    }
  }
  if (counts.wings == null && list.some((t) => mentions(t, "wings"))) counts.wings = 2;
  if (counts.tails == null && list.some((t) => mentions(t, "tails"))) counts.tails = 1;
  const spec: AnatomySpec = { counts };
  for (const text of list) {
    const m = new RegExp(`\\b${WORD}\\s+(?:[a-z]+\\s+){0,2}?horns\\b`).exec(` ${text.toLowerCase()} `);
    if (m && num(m[1])) {
      spec.horns = num(m[1])!;
      break;
    }
  }
  return spec;
}

/** Parts whose count differs from a human body plan. */
export function atypicalParts(spec: AnatomySpec | null | undefined): AnatomyPart[] {
  if (!spec) return [];
  return ANATOMY_PARTS.filter((p) => spec.counts[p] != null && spec.counts[p] !== HUMAN_DEFAULTS[p]);
}

export function hasAtypicalAnatomy(spec: AnatomySpec | null | undefined): boolean {
  return atypicalParts(spec).length > 0;
}

const SPOKEN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
function spoken(n: number): string {
  return SPOKEN[n] ?? String(n);
}

function armLayout(n: number): string {
  if (n === 1) return "a single arm";
  if (n === 2) return "two arms, one at each shoulder";
  if (n === 4) return "two upper arms at the shoulders and two lower arms just below them at the ribcage, mirrored left and right";
  if (n === 6) return "three pairs stacked down the torso: at the shoulders, at the mid-ribcage and at the waist, mirrored left and right";
  if (n % 2 === 0) return `${spoken(n / 2)} mirrored pairs stacked down the torso, starting at the shoulders`;
  return "arranged down the torso, starting at the shoulders";
}

function plural(part: AnatomyPart, n: number): string {
  const base = part.replace(/s$/, "");
  return n === 1 ? base : part;
}

/**
 * Positive, explicit body-plan sentence for the prompt. Empty when nothing
 * atypical is known. `selfie` keeps the phone in one hand so the model does
 * not grow a spare arm to hold it.
 */
export function anatomyClause(
  name: string,
  spec: AnatomySpec | null | undefined,
  opts: { framing?: string } = {},
): string {
  const atypical = atypicalParts(spec);
  if (!spec || !atypical.length) return "";
  const who = clean(name).slice(0, 60) || "The character";
  const c = spec.counts;
  const bits: string[] = [];
  if (c.arms != null) {
    const n = c.arms;
    bits.push(
      n === 2
        ? "exactly two arms"
        : `exactly ${spoken(n)} (${n}) arms in total (${armLayout(n)}), each ending in one hand with five fingers, so exactly ${spoken(n)} hands`,
    );
  }
  if (c.wings != null && c.wings > 0) bits.push(`exactly ${spoken(c.wings)} ${plural("wings", c.wings)} growing from the upper back${c.wings === 2 ? " (one pair)" : c.wings === 4 ? " (two pairs)" : ""}`);
  if (c.heads != null && c.heads !== 1) bits.push(`exactly ${spoken(c.heads)} heads`);
  if (c.eyes != null && c.eyes !== 2) bits.push(c.eyes === 3 ? "exactly three eyes (two eyes plus a third eye centered on the forehead)" : `exactly ${spoken(c.eyes)} ${plural("eyes", c.eyes)}`);
  if (c.legs != null) bits.push(`exactly ${spoken(c.legs)} ${plural("legs", c.legs)}`);
  if (c.tails != null && c.tails > 0) bits.push(`exactly ${spoken(c.tails)} ${plural("tails", c.tails)}`);
  if (typeof spec.horns === "number") bits.push(`exactly ${spoken(spec.horns)} horns`);
  const limbs = atypical.filter((p) => p === "arms" || p === "legs" || p === "wings" || p === "heads" || p === "tails");
  const guard = limbs.length
    ? ` Every limb is attached to ${who}'s body; no additional or duplicated ${limbs.join(", ")} or hands beyond these counts, none merged, floating or missing.`
    : "";
  const selfie =
    opts.framing === "selfie" && c.arms != null && c.arms !== 2
      ? ` One hand holds the phone; the other ${spoken(Math.max(0, c.arms - 1))} arms stay attached as described.`
      : "";
  return `Anatomy, must match exactly: ${who} has ${bits.join("; ")}.${guard}${selfie}`;
}

/** Negative-prompt terms for endpoints that honour one (fal PuLID with true CFG). */
export function anatomyNegativeTerms(spec: AnatomySpec | null | undefined): string {
  const atypical = atypicalParts(spec);
  if (!spec || !atypical.length) return "";
  const terms = ["extra limbs", "duplicated limbs", "fused limbs", "floating limbs", "malformed hands", "extra hands"];
  const c = spec.counts;
  if (c.arms != null) terms.push(`more than ${spoken(c.arms)} arms`, c.arms > 2 ? `only two arms` : "extra arms");
  if (c.wings != null) terms.push(`more than ${spoken(c.wings)} wings`);
  if (c.heads != null) terms.push(`more than ${spoken(c.heads)} heads`);
  return terms.join(", ");
}

/** Short summary for logs / metadata (no free text). */
export function anatomySummary(spec: AnatomySpec | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!spec) return out;
  for (const p of ANATOMY_PARTS) if (spec.counts[p] != null) out[p] = spec.counts[p]!;
  return out;
}

/**
 * Join prompt parts under `max` characters without ever cutting the head
 * (subject + body plan) or the tail (skin-tone guard, style, safety clause):
 * only the middle (scene, look, setting) is shortened when space runs out.
 */
export function fitPrompt(head: string[], middle: string[], tail: string[], max: number): string {
  const join = (xs: string[]) => xs.filter(Boolean).join(" ");
  const t = join(tail);
  let h = join(head);
  if (h.length + t.length + 1 > max) h = h.slice(0, Math.max(0, max - t.length - 1)).trim();
  const room = max - h.length - t.length - (h ? 1 : 0) - (t ? 1 : 0);
  let m = join(middle);
  if (m.length > room) {
    m = room > 0 ? m.slice(0, room) : "";
    const cut = m.lastIndexOf(" ");
    if (m && cut > room * 0.6) m = m.slice(0, cut);
    m = m.trim();
  }
  return join([h, m, t]).slice(0, max);
}
