/**
 * Purposeful journeys: every destination (zone or prop) carries data-driven
 * tags (needs it serves, topics, activity). chooseJourney scores them against
 * the companion's motives, personality and interest hints and returns the
 * best one with a human reason — or null to stay home.
 */
import { animaStandPoint, isWalkable } from "../collision";
import { portalAt } from "../areas";
import type { Area, JourneyTags, Need, Vec2 } from "../layout";
import { NEEDS, type Motives } from "./motives";

/**
 * Interest hints: things the companion has been thinking about.
 * TODO(Anima Backend Data / Builder): feed recent chat topics, memory_events
 * themes and user-mentioned interests here. No client-side source exists yet,
 * so the cyberworld passes an empty list.
 */
export type InterestHints = { topics: readonly string[]; source?: "chat" | "memory" | "user" };
export const NO_HINTS: InterestHints = { topics: [] };

export type Destination = {
  id: string;
  areaId: string;
  kind: "place" | "prop";
  label: string;
  point: Vec2;
  tags: JourneyTags;
  /** Companion who lives here (social visits), if any. */
  hostId?: string;
};

export type JourneyCompanion = { id: string; name: string; homeZoneId: string };

export type JourneyChoice = { destination: Destination; activity: string; reason: string; motive: Need; score: number; topic: string | null; summary?: string };

export type ChooseOptions = {
  currentAreaId?: string;
  /** Destinations visited recently (ids), penalised to avoid ping-ponging. */
  recent?: readonly string[];
  /** Who is at home right now (makes social visits worthwhile). */
  homeIds?: ReadonlySet<string>;
  /** 0..1 tie-break jitter source (deterministic in tests). */
  jitter?: () => number;
  /** Minimum score to leave; below it the companion stays put. */
  threshold?: number;
};

export const STAY_THRESHOLD = 0.22;
const HOP_PENALTY = 0.08;
const RECENT_PENALTY = 0.25;
const TOPIC_BONUS = 0.3;

function defaultTags(area: Area, zoneId: string, ownHome: string): JourneyTags | null {
  const z = area.zones.find((x) => x.id === zoneId)!;
  const name = z.label.replace(/\.EXE$/, "");
  if (z.kind === "hub") return { needs: { social: 0.6 }, topics: ["people", "friends"], activity: "people-watch in the plaza" };
  if (z.kind === "home") return z.id === ownHome ? { needs: { rest: 1 }, topics: ["home", "sleep"], activity: "rest at home", label: "home" } : { needs: { social: 0.9 }, topics: ["friends", name.toLowerCase()], activity: `catch up with ${name}`, label: `${name}'s homepage` };
  return { needs: { curiosity: 0.3 }, topics: [], activity: `look around ${z.label}` };
}

/** Walkable spot next to p (pulled toward `toward` if p itself is off the floor or in a gate). */
function reachable(area: Area, p: Vec2, toward: Vec2): Vec2 | null {
  for (let k = 0; k <= 1.0001; k += 0.1) {
    const q: Vec2 = [p[0] + (toward[0] - p[0]) * k, p[1] + (toward[1] - p[1]) * k];
    if (isWalkable(area, q, 0.4) && !portalAt(area, q)) return q;
  }
  return null;
}

/** Every tagged destination across the world's areas, from zone + decor data. */
export function destinationsFor(areas: readonly Area[], who: Pick<JourneyCompanion, "homeZoneId">): Destination[] {
  const out: Destination[] = [];
  for (const area of areas) {
    for (const z of area.zones) {
      const tags = z.journey ?? defaultTags(area, z.id, who.homeZoneId);
      if (!tags) continue;
      const point = z.kind === "home" ? (z.id === who.homeZoneId ? animaStandPoint(z) : reachable(area, [z.center[0] * 0.92, z.center[1] * 0.92], z.center)) : reachable(area, [z.center[0] + z.radius * 0.3, z.center[1] + z.radius * 0.2], z.center);
      if (point) out.push({ id: z.id, areaId: area.id, kind: "place", label: tags.label ?? z.label, point, tags, hostId: z.kind === "home" && z.id !== who.homeZoneId ? z.animaId : undefined });
    }
    for (const d of area.decor) {
      if (!d.journey) continue;
      const zone = area.zones.reduce((a, b) => (Math.hypot(b.center[0] - d.position[0], b.center[1] - d.position[2]) < Math.hypot(a.center[0] - d.position[0], a.center[1] - d.position[2]) ? b : a));
      const point = reachable(area, [d.position[0], d.position[2]], zone.center);
      if (point) out.push({ id: d.id.startsWith(`${area.id}:`) ? d.id : `${area.id}:${d.id}`, areaId: area.id, kind: "prop", label: d.journey.label ?? d.id, point, tags: d.journey });
    }
  }
  return out;
}

/** Reason phrasing: `now` for in-world thoughts ("Heading to X — now"), `past` for log summaries ("… because they past"). */
const REASONS: Record<Need, (d: Destination) => { now: string; past: string }> = {
  rest: (d) => (d.label === "home" ? { now: "tired, wants some quiet at home", past: "were tired and wanted some quiet" } : { now: "needs a quiet moment", past: "needed a quiet moment" }),
  curiosity: (d) => ({ now: `curious about ${d.label}`, past: `were curious about ${d.label}` }),
  social: (d) => {
    const host = d.label.replace(/'s homepage$/, "");
    return d.hostId ? { now: `misses ${host}`, past: `missed ${host}` } : { now: "wants to be around people", past: "wanted to be around people" };
  },
  creativity: (d) => ({ now: `looking for inspiration at ${d.label}`, past: `were looking for inspiration` }),
};

function topicNote(topic: string | null, hints: InterestHints): string {
  if (!topic) return "";
  return hints.source === "user" || hints.source === "chat" ? ` (you talked about ${topic})` : ` (been thinking about ${topic})`;
}

/** Present-tense reason shown in-world, e.g. "curious about the Landing Page signs". */
export function reasonFor(d: Destination, motive: Need, topic: string | null, hints: InterestHints): string {
  return REASONS[motive](d).now + topicNote(topic, hints);
}

/** "Echo went to the hero image because they were looking for inspiration." */
export function journeySummary(name: string, d: Destination, motive: Need, topic: string | null, hints: InterestHints): string {
  return `${name} went ${d.label === "home" ? "home" : `to ${d.label}`} because they ${REASONS[motive](d).past}${topicNote(topic, hints)}.`;
}

/**
 * Score destinations for a companion and pick the best, or null to stay.
 * score = Σ motive[n] · serves[n]  + topic bonus − area-hop / recent penalties (+ tiny jitter).
 */
export function chooseJourney(companion: JourneyCompanion, motives: Motives, hints: InterestHints, worldAreas: readonly Area[], opts: ChooseOptions = {}): JourneyChoice | null {
  const hintSet = new Set(hints.topics.map((t) => t.toLowerCase()));
  let best: JourneyChoice | null = null;
  for (const d of destinationsFor(worldAreas, companion)) {
    if (d.id === opts.recent?.[opts.recent.length - 1]) continue; // never re-pick where we just were
    let score = 0;
    let motive: Need = "curiosity";
    let top = -1;
    for (const n of NEEDS) {
      const part = motives[n] * (d.tags.needs[n] ?? 0);
      score += part;
      if (part > top) {
        top = part;
        motive = n;
      }
    }
    if (d.hostId && opts.homeIds && !opts.homeIds.has(d.hostId)) score *= 0.4; // nobody to chat with
    const topic = d.tags.topics?.find((t) => hintSet.has(t.toLowerCase())) ?? null;
    if (topic) score += TOPIC_BONUS;
    if (opts.currentAreaId && d.areaId !== opts.currentAreaId) score -= HOP_PENALTY;
    if (opts.recent?.includes(d.id)) score -= RECENT_PENALTY;
    score += (opts.jitter?.() ?? 0) * 0.02;
    if (!best || score > best.score) best = { destination: d, activity: d.tags.activity, reason: reasonFor(d, motive, topic, hints), motive, score, topic, summary: journeySummary(companion.name, d, motive, topic, hints) };
  }
  if (!best || best.score < (opts.threshold ?? STAY_THRESHOLD)) return null;
  return best;
}
