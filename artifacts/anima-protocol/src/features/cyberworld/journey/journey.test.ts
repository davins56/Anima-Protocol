import { describe, expect, it } from "vitest";
import { buildWorld } from "../areas";
import { homeZoneId, type WorldAnima } from "../layout";
import { MOCK_ANIMAS } from "../mockAnimas";
import { chooseJourney, destinationsFor, NO_HINTS } from "./choose";
import { initTraveller, releaseAt, tickTraveller, type Traveller } from "./journeys";
import { JOURNEY_LOG_KEY, localStorageSink, toMemoryEventRow, type JourneyEvent } from "./log";
import { driftMotives, initialMotives, NEUTRAL, personalityFromRecord, satisfy, type Motives } from "./motives";

const world = buildWorld(MOCK_ANIMAS);
const echo = MOCK_ANIMAS[2];
const who = { id: echo.id, name: echo.name, homeZoneId: homeZoneId(echo.id) };
const m = (o: Partial<Motives>): Motives => ({ rest: 0, curiosity: 0, social: 0, creativity: 0, ...o });
const T0 = Date.UTC(2026, 10, 13, 20, 0, 0);

describe("motives", () => {
  it("reads personality from existing companion text fields, neutral otherwise", () => {
    expect(personalityFromRecord(null)).toEqual(NEUTRAL);
    const p = personalityFromRecord({ personality: "A curious, bookish explorer", speaking_style: "quiet and calm" });
    expect(p.curiosity).toBeGreaterThan(1);
    expect(p.rest).toBeGreaterThan(1);
    expect(p.social).toBeLessThan(1);
  });

  it("drifts up with time (scaled by personality), is satisfied by activities, and seeds deterministically", () => {
    const base = m({ curiosity: 0.2 });
    const d = driftMotives(base, 2, { ...NEUTRAL, curiosity: 1.5 });
    expect(d.curiosity).toBeGreaterThan(driftMotives(base, 2).curiosity);
    expect(driftMotives(base, 1000).curiosity).toBe(1);
    expect(satisfy(m({ rest: 0.8 }), { rest: 1 }).rest).toBeCloseTo(0.24);
    expect(initialMotives(42)).toEqual(initialMotives(42));
  });
});

describe("chooseJourney", () => {
  it("curiosity picks a curiosity destination and says so", () => {
    const c = chooseJourney(who, m({ curiosity: 0.9 }), NO_HINTS, world.areas, { currentAreaId: "hub" })!;
    expect(c.motive).toBe("curiosity");
    expect(c.destination.tags.needs.curiosity).toBeGreaterThan(0.5);
    expect(c.reason).toMatch(/^curious about /);
    expect(c.summary).toBe(`Echo went to ${c.destination.label} because they were curious about ${c.destination.label}.`);
  });

  it("tiredness picks home", () => {
    const c = chooseJourney(who, m({ rest: 0.9 }), NO_HINTS, world.areas)!;
    expect(c.destination.id).toBe(who.homeZoneId);
    expect(c.activity).toBe("rest at home");
    expect(c.reason).toContain("tired");
  });

  it("social visits a friend who is home, and is less keen when nobody is in", () => {
    const home = new Set(MOCK_ANIMAS.map((a) => a.id));
    const c = chooseJourney(who, m({ social: 0.9 }), NO_HINTS, world.areas, { homeIds: home })!;
    expect(c.destination.hostId).toBeTruthy();
    expect(c.reason).toMatch(/^misses /);
    expect(c.activity).toMatch(/^catch up with /);
    const empty = chooseJourney(who, m({ social: 0.9 }), NO_HINTS, world.areas, { homeIds: new Set() })!;
    expect(empty.destination.hostId).toBeUndefined();
  });

  it("interest hints pull toward destinations tagged with the topic", () => {
    const c = chooseJourney(who, m({ curiosity: 0.3, creativity: 0.3 }), { topics: ["Design"], source: "chat" }, world.areas)!;
    expect(c.destination.tags.topics).toContain("design");
    expect(c.topic).toBe("design");
    expect(c.reason).toContain("(you talked about design)");
  });

  it("stays home when no motive is strong", () => {
    expect(chooseJourney(who, m({ curiosity: 0.1, social: 0.1 }), NO_HINTS, world.areas)).toBeNull();
  });

  it("does not re-pick the place it just visited", () => {
    const first = chooseJourney(who, m({ curiosity: 0.9 }), NO_HINTS, world.areas)!;
    const next = chooseJourney(who, m({ curiosity: 0.9 }), NO_HINTS, world.areas, { recent: [first.destination.id] })!;
    expect(next.destination.id).not.toBe(first.destination.id);
  });

  it("destinations come from zone and decor tags across areas", () => {
    const ids = destinationsFor(world.areas, who).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["hub", "hub:core", "hub:lounge", "landing:title", "landing:hero-img", "landing:footer", who.homeZoneId]));
  });
});

function run(t0: Traveller, ms: number, step = 250, ctx: Partial<Parameters<typeof tickTraveller>[2]> = {}) {
  let t = t0;
  const events: JourneyEvent[] = [];
  const modes = new Set<string>();
  const areas = new Set<string>([t.areaId]);
  for (let now = T0; now <= T0 + ms; now += step) {
    const r = tickTraveller(world, t, { now, dt: step / 1000, ...ctx });
    t = r.t;
    events.push(...r.events);
    modes.add(t.mode);
    areas.add(t.areaId);
  }
  return { t, events, modes, areas };
}

describe("journeys state machine", () => {
  const anima: WorldAnima = { ...echo, record: { personality: "curious" } };

  it("starts at home and is deterministic per companion + day", () => {
    const a = initTraveller(world, anima, "2026-11-13", T0)!;
    expect(a.mode).toBe("home");
    expect(initTraveller(world, anima, "2026-11-13", T0)).toEqual(a);
    expect(initTraveller(world, anima, "2026-11-14", T0)!.seed).not.toBe(a.seed);
  });

  it("leaves with a stated reason, travels, does the activity, and logs why", () => {
    const t0 = { ...initTraveller(world, anima, "2026-11-13", T0)!, motives: m({ curiosity: 0.95 }), until: T0 };
    const first = tickTraveller(world, t0, { now: T0, dt: 0.25 }).t;
    expect(first.mode).toBe("travel");
    expect(first.thought).toMatch(/^Heading to .+ — curious about /);
    const { events, modes } = run(first, 120_000);
    expect(modes.has("activity")).toBe(true);
    const e = events[0];
    expect(e).toMatchObject({ companionId: echo.id, kind: "journey", motive: "curiosity", activity: first.plan!.activity, reason: first.plan!.reason, targetId: first.plan!.destination.id });
    expect(e.summary).toMatch(/^Echo went to .+ because they /);
    expect(new Date(e.occurredAt).getTime()).toBeGreaterThan(T0);
    expect(run(first, 120_000).events).toEqual(events);
  });

  it("crosses a portal when the destination is in another area", () => {
    const t0 = { ...initTraveller(world, anima, "2026-11-13", T0)!, motives: m({ creativity: 0.95 }), until: T0 };
    const { areas, events } = run(t0, 240_000);
    expect(areas.has("landing")).toBe(true);
    expect(events.some((e) => e.areaId === "landing")).toBe(true);
  });

  it("pauses to greet a nearby player and resumes afterwards", () => {
    const t0 = { ...initTraveller(world, anima, "2026-11-13", T0)!, motives: m({ curiosity: 0.95 }), until: T0 };
    const moving = tickTraveller(world, t0, { now: T0, dt: 0.25 }).t;
    const greet = tickTraveller(world, moving, { now: T0 + 250, dt: 0.25, playerArea: "hub", playerPos: moving.pos }).t;
    expect(greet.mode).toBe("greet");
    expect(greet.pos).toEqual(moving.pos);
    expect(tickTraveller(world, greet, { now: T0 + 500, dt: 0.25, playerArea: "landing", playerPos: [0, 0] }).t.mode).toBe("travel");
  });

  it("released from Accompany, heads home from where the player is", () => {
    const t0 = initTraveller(world, anima, "2026-11-13", T0)!;
    const r = releaseAt(world, t0, "landing", [0, 9.5], T0);
    expect(r.areaId).toBe("landing");
    expect(r.mode).toBe("travel");
    expect(r.plan?.destination.id).toBe(t0.homeZoneId);
    const { t, events } = run(r, 15_000);
    expect(t.areaId).toBe("hub");
    expect(t.mode).toBe("home");
    expect(events.at(-1)?.summary).toMatch(/^Echo went home because they were (tired|done exploring for now)\.$/);
  });
});

describe("journey log", () => {
  const ev = (i: number, id = "c1"): JourneyEvent => ({ id: `${id}:${i}`, companionId: id, kind: "journey", areaId: "hub", targetId: "hub:core", activity: "listen to the data core", reason: "curious about the data core", motive: "curiosity", summary: "x", occurredAt: new Date(T0 + i).toISOString() });
  const memStore = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it("caps per companion, dedupes by id, tolerates junk", () => {
    const store = memStore();
    const sink = localStorageSink(store, 3);
    sink.record([ev(1), ev(2), ev(2), ev(3), ev(4), ev(1, "c2")]);
    expect(sink.list("c1").map((e) => e.id)).toEqual(["c1:2", "c1:3", "c1:4"]);
    expect(sink.list("c2")).toHaveLength(1);
    store.setItem(JOURNEY_LOG_KEY, "{not json");
    expect(sink.list("c1")).toEqual([]);
  });

  it("maps onto a memory_events row", () => {
    expect(toMemoryEventRow(ev(5), "user-1")).toEqual({
      user_id: "user-1",
      character_id: "c1",
      conversation_id: null,
      message_id: null,
      event_type: "cyberworld_journey",
      content: "x",
      payload: { kind: "journey", area_id: "hub", target_id: "hub:core", activity: "listen to the data core", reason: "curious about the data core", motive: "curiosity", journey_event_id: "c1:5" },
      emotional_weight: 0.2,
      dedupe_key: "journey:c1:5",
      source: "cyberworld",
      occurred_at: new Date(T0 + 5).toISOString(),
    });
  });
});
