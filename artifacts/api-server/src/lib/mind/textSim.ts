/** Small, dependency-free text similarity helpers for dedupe and overlap. */

const STOP = new Set(
  "a an the and or but if then so of to in on at for with from by is are was were be been am i me my you your we our it its this that these those he she they them his her their do did does have has had yes just very really".split(
    " ",
  ),
);

/**
 * Lower-case, keep letters and digits in every script (so 小明住在北京 and
 * 小明喜欢游泳 stay distinct), drop punctuation.
 */
export function normalizeText(text: unknown): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}\p{M}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Scripts written without spaces between words. */
const UNSPACED_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

export function contentTokens(text: unknown): string[] {
  const out: string[] = [];
  for (const w of normalizeText(text).split(" ")) {
    if (!w) continue;
    if (UNSPACED_SCRIPT_RE.test(w)) {
      // No word boundaries: compare character bigrams instead.
      const chars = [...w];
      if (chars.length === 1) out.push(w);
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!);
      continue;
    }
    if (w.length > 1 && !STOP.has(w)) out.push(w);
  }
  return out;
}

const NEGATION_RE = /\b(?:not|no|never|none|nobody|nothing|neither|nor|cannot|no longer|any more|anymore)\b|n't\b/i;

/** True when a statement is negated ("is not allergic", "doesn't eat meat"). */
export function isNegated(text: unknown): boolean {
  return NEGATION_RE.test(String(text ?? "").replace(/[’‘ʼ]/g, "'"));
}

export function tokenSet(text: unknown): Set<string> {
  return new Set(contentTokens(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Share of `a`'s tokens that also appear in `b` (containment). */
export function containment(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / a.size;
}

export function approxTokens(text: unknown): number {
  const n = String(text ?? "").length;
  return n === 0 ? 0 : Math.ceil(n / 4);
}

/** Stable short hash (FNV-1a) for dedupe keys. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
