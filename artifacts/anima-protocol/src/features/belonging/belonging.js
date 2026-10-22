// @ts-check
/**
 * Pure helpers for the belonging module (anima-belonging) as wired into Home.
 * Design constraints carried over: no absence tracking, no streaks, copy is
 * about what's there — never how long you've been away.
 */

/** Resurfacing is on unless the user switched it off. */
export function resurfacingAllowed(settings) {
  return settings?.belonging?.allow_memory_resurfacing !== false;
}

/**
 * @param {{ entries?: any[], events?: any[] }} input
 * @returns {{ unread: any[], latest: any | null }}
 */
export function pickResurfacing({ entries = [], events = [] } = {}) {
  const unread = entries.filter((e) => e && e.isRead !== true && e.is_read !== true).slice(0, 3);
  const latest = events.find((e) => e && (e.eventType === "chapter" || e.eventType === "milestone")) || events[0] || null;
  return { unread, latest };
}

export const MILESTONE_TYPES = new Set(["milestone", "first", "chapter", "breakthrough"]);

function ts(v) {
  const n = Date.parse(v || "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Photo Moments album: photos grouped under the relationship milestone they
 * followed. Newest section first; photos before any milestone go to
 * "Early days".
 * @param {Array<{ id: string, created_at: string }>} photos
 * @param {Array<{ id: string, eventType: string, title: string, occurredAt?: string, createdAt?: string }>} events
 */
export function buildPhotoAlbum(photos = [], events = []) {
  const milestones = events
    .filter((e) => e && MILESTONE_TYPES.has(e.eventType))
    .map((e) => ({ ...e, at: ts(e.occurredAt || e.createdAt) }))
    .sort((a, b) => a.at - b.at);
  /** @type {Map<string, { key: string, title: string, at: number, eventType: string | null, photos: any[] }>} */
  const sections = new Map();
  const early = { key: "early", title: "Early days", at: 0, eventType: null, photos: [] };
  for (const p of [...photos].sort((a, b) => ts(b.created_at) - ts(a.created_at))) {
    const t = ts(p.created_at);
    let owner = null;
    for (const m of milestones) if (m.at <= t) owner = m;
    if (!owner) {
      early.photos.push(p);
      continue;
    }
    if (!sections.has(owner.id)) {
      sections.set(owner.id, { key: owner.id, title: owner.title || "A moment", at: owner.at, eventType: owner.eventType, photos: [] });
    }
    sections.get(owner.id)?.photos.push(p);
  }
  const out = [...sections.values()].sort((a, b) => b.at - a.at);
  if (early.photos.length) out.push(early);
  return out;
}
