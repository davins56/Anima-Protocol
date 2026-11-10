/** Small, dependency-free text similarity helpers for dedupe and overlap. */

const STOP = new Set(
  "a an the and or but if then so of to in on at for with from by is are was were be been am i me my you your we our it its this that these those he she they them his her their do did does have has had not no yes just very really".split(
    " ",
  ),
);

export function normalizeText(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentTokens(text: unknown): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
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
