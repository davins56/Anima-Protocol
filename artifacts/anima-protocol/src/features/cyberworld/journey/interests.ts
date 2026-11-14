/**
 * Companion interests → journey hints. GET /api/memory/journey-interests
 * (#724) returns topics drawn from chat + memory; they feed chooseJourney's
 * InterestHints, which boosts destinations whose topic tags match. Cached per
 * companion (~30 min); failures fall back to no hints.
 */
import { NO_HINTS, type InterestHints } from "./choose";
import { isMockId } from "./sync";

export const INTERESTS_TTL_MS = 30 * 60_000;
export const INTERESTS_FAIL_TTL_MS = 5 * 60_000;
const MAX_TOPICS = 12;

/** Normalise the API body into hints: lowercase single-word topics (+ singular form), deduped. */
export function interestsToHints(body: unknown): InterestHints {
  const b = (body && typeof body === "object" ? body : {}) as { topics?: unknown; source?: unknown };
  if (!Array.isArray(b.topics)) return NO_HINTS;
  const out: string[] = [];
  for (const t of b.topics.slice(0, MAX_TOPICS)) {
    if (typeof t !== "string") continue;
    const w = t.trim().toLowerCase();
    if (!w || isMockId(w)) continue;
    for (const v of [w, w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : null]) if (v && !out.includes(v)) out.push(v);
  }
  if (!out.length) return NO_HINTS;
  // "you talked about X" only when the server says the topics came from chat.
  return { topics: out, source: b.source === "chat" ? "chat" : "memory" };
}

export type InterestFetcher = (characterId: string) => Promise<unknown>;

/** Sync lookup for the journey tick; misses trigger a background fetch. */
export function createInterestCache(opts: { fetcher: InterestFetcher; enabled?: () => boolean; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { hints: InterestHints; until: number }>();
  const inflight = new Set<string>();
  const load = (id: string) => {
    inflight.add(id);
    opts
      .fetcher(id)
      .then((body) => cache.set(id, { hints: interestsToHints(body), until: now() + INTERESTS_TTL_MS }))
      .catch(() => cache.set(id, { hints: NO_HINTS, until: now() + INTERESTS_FAIL_TTL_MS }))
      .finally(() => inflight.delete(id));
  };
  return {
    get(id: string): InterestHints {
      if (isMockId(id)) return NO_HINTS;
      const hit = cache.get(id);
      if ((!hit || hit.until <= now()) && !inflight.has(id) && (opts.enabled?.() ?? true)) load(id);
      return hit?.hints ?? NO_HINTS;
    },
    clear: () => cache.clear(),
  };
}
