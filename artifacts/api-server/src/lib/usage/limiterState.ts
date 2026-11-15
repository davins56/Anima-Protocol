/**
 * Pure fixed-window counters for the per-user limiter (security audit
 * 2026-11-14 H1). Used by the `UserRateLimiter` Durable Object (one object
 * per user) and by the in-process fallback. No I/O here so it is unit-tested
 * directly.
 */

export type LimitRule = {
  /** Bucket name, e.g. "photo:min" or "free_photo:day". */
  name: string;
  /** Max units per window. 0 or less blocks everything. */
  max: number;
  windowMs: number;
};

export type Bucket = { windowStart: number; used: number };
export type LimiterBook = { buckets: Record<string, Bucket> };

export type HitResult =
  | { allowed: true; remaining: Record<string, number> }
  | { allowed: false; rule: string; retryAfterMs: number };

const MAX_WINDOW_MS = 31 * 86_400_000;

export function normalizeBook(raw: unknown): LimiterBook {
  const buckets: Record<string, Bucket> = {};
  const src = (raw as LimiterBook | null | undefined)?.buckets;
  if (src && typeof src === "object") {
    for (const [key, value] of Object.entries(src)) {
      const windowStart = Number((value as Bucket)?.windowStart);
      const used = Number((value as Bucket)?.used);
      if (Number.isFinite(windowStart) && Number.isFinite(used) && used > 0) {
        buckets[key] = { windowStart, used };
      }
    }
  }
  return { buckets };
}

export function sanitizeRules(rules: unknown): LimitRule[] {
  if (!Array.isArray(rules)) return [];
  const out: LimitRule[] = [];
  for (const rule of rules.slice(0, 8)) {
    const name = typeof rule?.name === "string" ? rule.name.slice(0, 64) : "";
    const max = Math.floor(Number(rule?.max));
    const windowMs = Math.floor(Number(rule?.windowMs));
    if (!name || !Number.isFinite(max) || !Number.isFinite(windowMs)) continue;
    if (windowMs < 1_000 || windowMs > MAX_WINDOW_MS) continue;
    out.push({ name, max, windowMs });
  }
  return out;
}

/** Fixed windows aligned to the epoch, so a day window resets at 00:00 UTC. */
export function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

function key(rule: LimitRule): string {
  return `${rule.name}@${rule.windowMs}`;
}

function usedNow(book: LimiterBook, rule: LimitRule, now: number): number {
  const bucket = book.buckets[key(rule)];
  if (!bucket) return 0;
  return bucket.windowStart === windowStartFor(now, rule.windowMs) ? bucket.used : 0;
}

/** Drop buckets whose window has passed so storage stays tiny. */
export function pruneBook(book: LimiterBook, now: number): void {
  for (const [k, bucket] of Object.entries(book.buckets)) {
    const windowMs = Number(k.split("@").pop());
    if (!Number.isFinite(windowMs) || bucket.windowStart + windowMs <= now) {
      delete book.buckets[k];
    }
  }
}

/**
 * All-or-nothing: if any rule would go over, nothing is counted and the
 * longest wait is returned.
 */
export function applyHit(book: LimiterBook, rules: LimitRule[], cost: number, now: number): HitResult {
  pruneBook(book, now);
  const units = Math.max(1, Math.floor(cost) || 1);
  let blocked: { rule: string; retryAfterMs: number } | null = null;
  for (const rule of rules) {
    if (usedNow(book, rule, now) + units > rule.max) {
      const retryAfterMs = windowStartFor(now, rule.windowMs) + rule.windowMs - now;
      if (!blocked || retryAfterMs > blocked.retryAfterMs) {
        blocked = { rule: rule.name, retryAfterMs };
      }
    }
  }
  if (blocked) return { allowed: false, ...blocked };
  const remaining: Record<string, number> = {};
  for (const rule of rules) {
    const start = windowStartFor(now, rule.windowMs);
    const used = usedNow(book, rule, now) + units;
    book.buckets[key(rule)] = { windowStart: start, used };
    remaining[rule.name] = Math.max(0, rule.max - used);
  }
  return { allowed: true, remaining };
}

/** Give units back (provider failed). Only touches the current window. */
export function applyRefund(book: LimiterBook, rules: LimitRule[], cost: number, now: number): void {
  const units = Math.max(1, Math.floor(cost) || 1);
  for (const rule of rules) {
    const bucket = book.buckets[key(rule)];
    if (!bucket || bucket.windowStart !== windowStartFor(now, rule.windowMs)) continue;
    bucket.used = Math.max(0, bucket.used - units);
    if (bucket.used === 0) delete book.buckets[key(rule)];
  }
}
