/**
 * Purposeful companion journeys: a small deterministic state machine per
 * resident Anima, driven by motives (./motives) and chooseJourney (./choose).
 *
 *   home ──(a motive is strong enough)──▶ travel ──▶ activity ──▶ next journey or home
 *     ▲            direct route, via a portal when the place is in another area │
 *     └─────────────────────────────────────────────────────────────────────────┘
 *   greet: pauses and faces the player while they are close (Talk/Customise).
 *
 * Pure (no React / three): the same tick drives on-screen companions (fine
 * tick) and companions in other areas (coarse tick, nothing rendered).
 */
import { travel } from "../areas";
import { animaStandPoint, isWalkable, planRoute, stepToward } from "../collision";
import { hashString, mulberry32 } from "../explore/rng";
import { HUB_AREA_ID, homeZoneId, type Area, type Need, type Portal, type Vec2, type World, type WorldAnima } from "../layout";
import { chooseJourney, destinationsFor, journeySummary, NO_HINTS, type Destination, type InterestHints, type JourneyChoice } from "./choose";
import type { JourneyEvent } from "./log";
import { driftMotives, initialMotives, personalityFromRecord, satisfy, type Motives, type Personality } from "./motives";

export const JOURNEY_SPEED = 2.4; // units / s (the player walks at 6)
export const GREET_RADIUS = 2.6;
/** Journeys in a row before heading home regardless. */
export const MAX_CHAIN = 3;
export const THOUGHT_MS = 4500;
const HOME_CHECK_MS = 6000;

export const MOTIVE_GLYPH: Record<Need, string> = { rest: "z", curiosity: "?", social: "♪", creativity: "✦" };

export type JourneyMode = "home" | "travel" | "activity" | "greet";

export type Traveller = {
  id: string;
  name: string;
  homeArea: string;
  homeZoneId: string;
  areaId: string;
  pos: Vec2;
  heading: number;
  mode: JourneyMode;
  /** Mode to resume after a greet. */
  resume: Exclude<JourneyMode, "greet">;
  /** Waypoints of the current leg (in areaId). */
  route: Vec2[];
  /** Portal ending the current leg, when the destination is in another area. */
  via: Portal | null;
  plan: JourneyChoice | null;
  /** Activity spot; idle movement stays within a small radius of it. */
  anchor: Vec2 | null;
  /** Epoch ms: activity end / next home check. */
  until: number;
  motives: Motives;
  personality: Personality;
  /** Destination ids, most recent last (short). */
  recent: string[];
  chain: number;
  thought: string | null;
  thoughtUntil: number;
  seed: number;
  decisions: number;
};

export type TickContext = {
  now: number;
  /** Seconds since this traveller's last tick. */
  dt: number;
  playerArea?: string | null;
  playerPos?: Vec2 | null;
  hints?: InterestHints;
  /** Companions currently at home (social visits only make sense if the host is in). */
  homeIds?: ReadonlySet<string>;
};

const areaOf = (world: World, id: string): Area | undefined => world.areas.find((a) => a.id === id);

export function journeySeed(animaId: string, dayKey: string): number {
  return hashString(`journey|${animaId}|${dayKey}`);
}

function rngFor(t: Pick<Traveller, "seed" | "decisions">): () => number {
  return mulberry32((t.seed + Math.imul(t.decisions + 1, 0x9e3779b1)) >>> 0);
}

/** Fresh traveller resting at its homepage, or null when it has no home in this world. */
export function initTraveller(world: World, anima: WorldAnima, dayKey: string, now: number): Traveller | null {
  const hz = homeZoneId(anima.id);
  const zone = areaOf(world, HUB_AREA_ID)?.zones.find((z) => z.id === hz);
  if (!zone) return null;
  const seed = journeySeed(anima.id, dayKey);
  const pos = animaStandPoint(zone);
  return {
    id: anima.id,
    name: anima.name,
    homeArea: HUB_AREA_ID,
    homeZoneId: hz,
    areaId: HUB_AREA_ID,
    pos,
    heading: Math.atan2(-pos[0], -pos[1]),
    mode: "home",
    resume: "home",
    route: [],
    via: null,
    plan: null,
    anchor: pos,
    // Stagger first decisions so residents don't all leave at once.
    until: now + 2500 + Math.floor(mulberry32(seed)() * 8000),
    motives: initialMotives(seed),
    personality: personalityFromRecord(anima.record),
    recent: [],
    chain: 0,
    thought: null,
    thoughtUntil: 0,
    seed,
    decisions: 0,
  };
}

/** Plan the next leg: straight to the destination, or to the gate that leads to its area. */
function planLeg(world: World, t: Traveller): Traveller {
  const dest = t.plan?.destination;
  const area = areaOf(world, t.areaId);
  if (!dest || !area) return { ...t, route: [], via: null };
  if (dest.areaId === t.areaId) return { ...t, route: planRoute(area, t.pos, dest.point), via: null };
  const gate = area.portals.find((g) => g.to.area === dest.areaId) ?? area.portals.find((g) => g.to.area === HUB_AREA_ID) ?? null;
  return { ...t, route: gate ? planRoute(area, t.pos, gate.position) : [], via: gate };
}

export function startJourney(world: World, t: Traveller, choice: JourneyChoice, now: number): Traveller {
  const label = choice.destination.label;
  const thought = choice.destination.id === t.homeZoneId ? `Heading home — ${choice.reason}` : `Heading to ${label} — ${choice.reason}`;
  const next = planLeg(world, { ...t, mode: "travel", resume: "travel", plan: choice, anchor: null, thought, thoughtUntil: now + THOUGHT_MS, decisions: t.decisions + 1 });
  // Unreachable: stay where we are and think again later.
  if (!next.route.length) return { ...t, plan: null, until: now + HOME_CHECK_MS, decisions: t.decisions + 1 };
  return next;
}

function homeDestination(world: World, t: Traveller): Destination | null {
  return destinationsFor(world.areas, t).find((d) => d.id === t.homeZoneId) ?? null;
}

function goHome(world: World, t: Traveller, now: number): Traveller {
  const d = homeDestination(world, t);
  if (!d) return { ...t, mode: "home", resume: "home", until: now + HOME_CHECK_MS };
  const tired = t.motives.rest > 0.45;
  const reason = tired ? "tired, wants some quiet at home" : "done exploring for now";
  const summary = `${t.name} went home because they ${tired ? "were tired" : "were done exploring for now"}.`;
  return startJourney(world, t, { destination: d, activity: d.tags.activity, reason, motive: "rest", score: 0, topic: null, summary }, now);
}

function choose(world: World, t: Traveller, ctx: TickContext): JourneyChoice | null {
  const jitter = rngFor(t);
  return chooseJourney(t, t.motives, ctx.hints ?? NO_HINTS, world.areas, { currentAreaId: t.areaId, recent: t.recent, homeIds: ctx.homeIds, jitter });
}

function journeyEvent(t: Traveller, choice: JourneyChoice, now: number): JourneyEvent {
  const d = choice.destination;
  return {
    id: `${t.id}:${now}`,
    companionId: t.id,
    kind: "journey",
    areaId: d.areaId,
    targetId: d.id,
    activity: choice.activity,
    reason: choice.reason,
    motive: choice.motive,
    summary: choice.summary ?? journeySummary(t.name, d, choice.motive, choice.topic, NO_HINTS),
    occurredAt: new Date(now).toISOString(),
  };
}

function arrive(world: World, t: Traveller, now: number): { t: Traveller; events: JourneyEvent[] } {
  const plan = t.plan!;
  const d = plan.destination;
  const events = [journeyEvent(t, plan, now)];
  const rnd = rngFor(t);
  const recent = [...t.recent, d.id].slice(-4);
  if (d.id === t.homeZoneId) {
    return { t: { ...t, mode: "home", resume: "home", plan: null, route: [], anchor: d.point, chain: 0, recent, until: now + HOME_CHECK_MS * 2, decisions: t.decisions + 1 }, events };
  }
  const until = now + 8000 + Math.floor(rnd() * 7000);
  return { t: { ...t, mode: "activity", resume: "activity", route: [], anchor: d.point, until, recent, thought: `${MOTIVE_GLYPH[plan.motive]} ${plan.activity}`, thoughtUntil: until, decisions: t.decisions + 1 }, events };
}

function walk(world: World, t: Traveller, dt: number): Traveller {
  const area = areaOf(world, t.areaId);
  if (!area) return t;
  let pos = t.pos;
  let route = t.route;
  let heading = t.heading;
  let budget = JOURNEY_SPEED * dt;
  while (budget > 1e-6 && route.length) {
    const step = stepToward(area, pos, route[0], budget);
    const moved = Math.hypot(step.next[0] - pos[0], step.next[1] - pos[1]);
    if (moved > 1e-6) heading = Math.atan2(step.next[0] - pos[0], step.next[1] - pos[1]);
    pos = step.next;
    budget -= moved;
    if (!step.done) break; // the whole budget went into a partial step
    route = route.slice(1);
  }
  return { ...t, pos, route, heading };
}

/** Advance one traveller. Pure: returns the next state and any journey events. */
export function tickTraveller(world: World, t0: Traveller, ctx: TickContext): { t: Traveller; events: JourneyEvent[] } {
  const { now } = ctx;
  let t: Traveller = { ...t0, motives: driftMotives(t0.motives, ctx.dt / 60, t0.personality) };
  if (t.thought && now >= t.thoughtUntil) t = { ...t, thought: null };

  const near = ctx.playerArea === t.areaId && !!ctx.playerPos && Math.hypot(ctx.playerPos[0] - t.pos[0], ctx.playerPos[1] - t.pos[1]) <= GREET_RADIUS;
  if (near && ctx.playerPos) return { t: { ...t, mode: "greet", heading: Math.atan2(ctx.playerPos[0] - t.pos[0], ctx.playerPos[1] - t.pos[1]) }, events: [] };
  if (t.mode === "greet") t = { ...t, mode: t.resume };

  switch (t.mode) {
    case "home": {
      // Resting at home quietly satisfies rest.
      t = { ...t, motives: satisfy(t.motives, { rest: 1 }, Math.min(1, ctx.dt / 60)) };
      if (now < t.until) return { t, events: [] };
      const choice = choose(world, t, ctx);
      if (!choice || choice.destination.id === t.homeZoneId) return { t: { ...t, until: now + HOME_CHECK_MS, decisions: t.decisions + 1 }, events: [] };
      return { t: startJourney(world, t, choice, now), events: [] };
    }
    case "activity": {
      const a = t.anchor ?? t.pos;
      const area = areaOf(world, t.areaId);
      // Idle movement only inside the activity: a slow sway around the spot.
      const k = now / 1000 + (t.seed % 97);
      const sway: Vec2 = [a[0] + Math.sin(k * 0.6) * 0.35, a[1] + Math.cos(k * 0.45) * 0.35];
      if (area && isWalkable(area, sway, 0.3)) t = { ...t, pos: sway };
      if (now < t.until) return { t, events: [] };
      const done = { ...t, motives: satisfy(t.motives, t.plan?.destination.tags.needs ?? {}), chain: t.chain + 1, plan: null, decisions: t.decisions + 1 };
      if (done.chain >= MAX_CHAIN) return { t: goHome(world, done, now), events: [] };
      const next = choose(world, done, ctx);
      return { t: next && next.destination.id !== t.homeZoneId ? startJourney(world, done, next, now) : goHome(world, done, now), events: [] };
    }
    case "travel": {
      t = walk(world, t, ctx.dt);
      if (t.route.length) return { t, events: [] };
      if (t.via) {
        const hop = travel(world, t.via);
        if (!hop) return { t: goHome(world, { ...t, via: null }, now), events: [] };
        return { t: planLeg(world, { ...t, areaId: hop.area.id, pos: hop.spawn, via: null }), events: [] };
      }
      return t.plan ? arrive(world, t, now) : { t: { ...t, mode: "home", resume: "home", until: now + HOME_CHECK_MS }, events: [] };
    }
    default:
      return { t, events: [] };
  }
}

/** Accompany mode ends: the companion stays where the player is, then heads home. */
export function releaseAt(world: World, t: Traveller, areaId: string, pos: Vec2, now: number): Traveller {
  return goHome(world, { ...t, areaId, pos, mode: "home", resume: "home", route: [], via: null, plan: null, anchor: null }, now);
}

/** Nearest traveller to p in an area within radius. */
export function nearestTraveller(ts: readonly Traveller[], areaId: string, p: Vec2, radius = GREET_RADIUS, skipId?: string | null): Traveller | null {
  let best: Traveller | null = null;
  let bd = radius;
  for (const t of ts) {
    if (t.areaId !== areaId || t.id === skipId) continue;
    const d = Math.hypot(t.pos[0] - p[0], t.pos[1] - p[1]);
    if (d <= bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** One line for the Talk panel: what they're up to and why. */
export function statusLine(t: Traveller, world: World): string {
  const where = areaOf(world, t.areaId)?.label ?? t.areaId;
  if (t.plan && (t.mode === "travel" || t.resume === "travel")) return `On the way to ${t.plan.destination.label} — ${t.plan.reason}.`;
  if (t.plan && (t.mode === "activity" || t.resume === "activity")) return `Here to ${t.plan.activity} — ${t.plan.reason}.`;
  return t.areaId === t.homeArea ? "Home, taking it easy." : `Hanging out in ${where}.`;
}
