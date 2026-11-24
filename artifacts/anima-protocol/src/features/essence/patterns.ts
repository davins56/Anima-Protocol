import type { DreamJournalEntry } from "@/lib/dreamJournal";

export type Tally = { label: string; count: number };

function tally(values: string[], limit: number): Tally[] {
  const map = new Map<string, number>();
  for (const raw of values) {
    const v = raw.trim().toLowerCase();
    if (v) map.set(v, (map.get(v) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export function dreamMoods(dreams: DreamJournalEntry[], limit = 8): Tally[] {
  return tally(dreams.map((d) => (typeof d.mood === "string" ? d.mood : "")), limit);
}

export function dreamThemes(dreams: DreamJournalEntry[], limit = 12): Tally[] {
  return tally(dreams.flatMap((d) => d.themes || []), limit);
}

/** Dreams per ISO week (Monday start, UTC), oldest first, for a small bar strip. */
export function dreamsPerWeek(dreams: DreamJournalEntry[], weeks = 8, now = new Date()): Tally[] {
  const DAY = 86_400_000;
  const start = (t: number) => {
    const d = new Date(t);
    const day = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
  };
  const thisWeek = start(now.getTime());
  const buckets: Tally[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const w = thisWeek - i * 7 * DAY;
    buckets.push({ label: new Date(w).toISOString().slice(5, 10), count: 0 });
  }
  for (const d of dreams) {
    const t = Date.parse(d.created_at);
    if (!Number.isFinite(t)) continue;
    const idx = weeks - 1 - Math.round((thisWeek - start(t)) / (7 * DAY));
    if (idx >= 0 && idx < weeks) buckets[idx].count += 1;
  }
  return buckets;
}
