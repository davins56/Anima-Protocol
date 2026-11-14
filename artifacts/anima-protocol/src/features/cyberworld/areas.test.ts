import { describe, expect, it } from "vitest";
import { AREA_BUILDERS, areaById, arrivalPoint, buildLandingArea, buildWorld, LANDING_AREA_ID, portalAt, travel, validateWorld } from "./areas";
import { distanceToSegment, inZone, isWalkable, planRoute, stepToward, zoneContaining } from "./collision";
import { areaBounds, buildWorldLayout, HUB_AREA_ID, hubFreeAngle, MAX_HOMES, rectZone, zoneEdgeDistance, type Vec2, type World } from "./layout";
import { MOCK_ANIMAS } from "./mockAnimas";

const residents = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));

describe("world registry", () => {
  it("has a hub start area, a landing page and the Data Bazaar, one builder each", () => {
    const world = buildWorld(MOCK_ANIMAS);
    expect(world.start).toBe(HUB_AREA_ID);
    expect(world.areas.map((a) => a.id)).toEqual([HUB_AREA_ID, LANDING_AREA_ID, "market"]);
    expect(AREA_BUILDERS).toHaveLength(world.areas.length);
  });

  it.each(Array.from({ length: MAX_HOMES + 3 }, (_, n) => n))("is valid with %i residents (portals linked both ways, off spokes, arrivals walkable)", (n) => {
    expect(validateWorld(buildWorld(residents(n)))).toEqual([]);
  });

  it("travels hub → landing → hub and lands clear of the gate", () => {
    const world = buildWorld(MOCK_ANIMAS);
    const hub = areaById(world, HUB_AREA_ID)!;
    const out = travel(world, hub.portals[0])!;
    expect(out.area.id).toBe(LANDING_AREA_ID);
    expect(isWalkable(out.area, out.spawn)).toBe(true);
    expect(portalAt(out.area, out.spawn)).toBeNull();
    const back = travel(world, out.area.portals[0])!;
    expect(back.area.id).toBe(HUB_AREA_ID);
    expect(portalAt(back.area, back.spawn)).toBeNull();
    expect(inZone(back.area.zones[0], back.spawn)).toBe(true);
  });

  it("reports broken and one-way links", () => {
    const world = buildWorld(MOCK_ANIMAS);
    const broken: World = {
      ...world,
      areas: world.areas.map((a) => (a.id === HUB_AREA_ID ? { ...a, portals: [{ ...a.portals[0], to: { area: "nowhere", portal: "x" } }] } : a)),
    };
    expect(validateWorld(broken).join("\n")).toMatch(/missing nowhere\/x/);
    expect(validateWorld(broken).join("\n")).toMatch(/no matching return link/);
  });

  it("portalAt respects the trigger radius", () => {
    const landing = buildLandingArea();
    const g = landing.portals[0];
    expect(portalAt(landing, g.position)?.id).toBe(g.id);
    expect(portalAt(landing, [g.position[0] + g.radius + 0.1, g.position[1]])).toBeNull();
    const a = arrivalPoint(landing, g);
    expect(Math.hypot(a[0] - g.position[0], a[1] - g.position[1])).toBeGreaterThan(g.radius);
  });
});

describe("hubFreeAngle", () => {
  it("keeps the gate off every spoke and away from the south spawn", () => {
    for (let n = 0; n <= MAX_HOMES; n++) {
      const a = hubFreeAngle(n);
      const gate: Vec2 = [Math.cos(a) * 4.2, Math.sin(a) * 4.2];
      const hub = buildWorldLayout(residents(n));
      for (const p of hub.paths.filter((x) => x.from === "hub")) {
        const home = hub.zones.find((z) => z.id === p.to)!;
        expect(distanceToSegment(gate, [0, 0], home.center)).toBeGreaterThan(1.2);
      }
      expect(Math.hypot(gate[0] - hub.spawn[0], gate[1] - hub.spawn[1])).toBeGreaterThan(2);
    }
  });
});

describe("rect zones", () => {
  const z = rectZone({ id: "r", kind: "site", label: "R", center: [2, 3], size: [8, 4], color: "#fff" });
  it("collides on the rectangle, not the derived radius", () => {
    expect(z.radius).toBe(2);
    expect(inZone(z, [5.5, 3])).toBe(true);
    expect(inZone(z, [6.5, 3])).toBe(false);
    expect(inZone(z, [2, 5.5])).toBe(false);
  });
  it("measures centre-to-edge along a direction", () => {
    expect(zoneEdgeDistance(z, 1, 0)).toBeCloseTo(4);
    expect(zoneEdgeDistance(z, 0, 1)).toBeCloseTo(2);
  });
  it("feeds area bounds", () => {
    const b = areaBounds(buildLandingArea(), 0);
    expect(b.minX).toBeCloseTo(-8);
    expect(b.maxX).toBeCloseTo(8);
    expect(b.minZ).toBeCloseTo(-10.5);
    expect(b.maxZ).toBeCloseTo(13.5);
  });
});

describe("planRoute", () => {
  const hub = buildWorldLayout(MOCK_ANIMAS);
  const follow = (from: Vec2, route: Vec2[]) => {
    let p = from;
    for (const wp of route) {
      for (let i = 0; i < 500; i++) {
        const s = stepToward(hub, p, wp, 0.25);
        p = s.next;
        expect(isWalkable(hub, p)).toBe(true);
        if (s.done) break;
      }
    }
    return p;
  };

  it("goes straight within one zone", () => {
    expect(planRoute(hub, [0, 3], [2, -2])).toEqual([[2, -2]]);
  });

  it("routes from the plaza to the east home via the hub centre and spoke", () => {
    const east = hub.zones.find((z) => z.center[0] > 10)!;
    const route = planRoute(hub, hub.spawn, east.center);
    expect(route[0]).toEqual([0, 0]);
    const end = follow(hub.spawn, route);
    expect(zoneContaining(hub, end)?.id).toBe(east.id);
  });

  it("can start on a path and uses the ring when shorter", () => {
    const [n, e] = [hub.zones[1], hub.zones[2]];
    const onSpoke: Vec2 = [n.center[0] / 2, n.center[1] / 2];
    const route = planRoute(hub, n.center, e.center);
    // North → east is shorter along the ring than back through the hub.
    expect(route).not.toContainEqual([0, 0]);
    const end = follow(onSpoke, planRoute(hub, onSpoke, e.center));
    expect(zoneContaining(hub, end)?.id).toBe(e.id);
  });

  it("returns [] for targets off the network", () => {
    expect(planRoute(hub, hub.spawn, [40, 40])).toEqual([]);
  });
});
