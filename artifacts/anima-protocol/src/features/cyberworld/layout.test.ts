import { describe, expect, it } from "vitest";
import { buildWorldLayout, HOME_RING_RADIUS, MAX_HOMES, homeZoneId } from "./layout";
import { animaStandPoint, approachPoint, distanceToSegment, isWalkable, nearestAnima, resolveMove, stepToward } from "./collision";
import { MOCK_ANIMAS } from "./mockAnimas";
import { toWorldAnimas } from "./useCyberworldAnimas";

const animas = MOCK_ANIMAS;
const layout = buildWorldLayout(animas);

describe("buildWorldLayout", () => {
  it("creates a hub plus one homepage per Anima on the ring", () => {
    expect(layout.zones[0].kind).toBe("hub");
    const homes = layout.zones.filter((z) => z.kind === "home");
    expect(homes).toHaveLength(animas.length);
    for (const h of homes) expect(Math.hypot(...h.center)).toBeCloseTo(HOME_RING_RADIUS, 2);
    expect(homes.map((h) => h.id)).toEqual(animas.map((a) => homeZoneId(a.id)));
  });

  it("links every home to the hub, and neighbours in a ring when 3+", () => {
    const spokes = layout.paths.filter((p) => p.from === "hub");
    expect(spokes).toHaveLength(animas.length);
    expect(layout.paths.filter((p) => p.id.startsWith("ring:"))).toHaveLength(animas.length);
    expect(buildWorldLayout(animas.slice(0, 2)).paths).toHaveLength(2);
  });

  it("caps homes and handles an empty roster", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    expect(buildWorldLayout(many).zones).toHaveLength(MAX_HOMES + 1);
    const empty = buildWorldLayout([]);
    expect(empty.zones).toHaveLength(1);
    expect(isWalkable(empty, empty.spawn)).toBe(true);
  });
});

describe("collision", () => {
  it("measures distance to a segment", () => {
    expect(distanceToSegment([0, 1], [-1, 0], [1, 0])).toBeCloseTo(1);
    expect(distanceToSegment([3, 0], [-1, 0], [1, 0])).toBeCloseTo(2);
  });

  it("spawn, hub, homes and path midpoints are walkable; the void is not", () => {
    expect(isWalkable(layout, layout.spawn)).toBe(true);
    for (const z of layout.zones) expect(isWalkable(layout, z.center)).toBe(true);
    const home = layout.zones[1];
    expect(isWalkable(layout, [home.center[0] / 2, home.center[1] / 2])).toBe(true);
    expect(isWalkable(layout, [40, 40])).toBe(false);
    // Between two spokes, outside the hub, off the ring path.
    expect(isWalkable(layout, [9, -9])).toBe(false);
  });

  it("blocks walking off the edge but slides along it", () => {
    // Diagonal off the hub, between spokes: blocked outright.
    const edge: [number, number] = [3.5, 3.5];
    expect(resolveMove(layout, edge, [5, 5])).toEqual(edge);
    // Pushing diagonally into the hub rim next to the south spoke slides onto the spoke.
    const slid = resolveMove(layout, [0.2, 5.6], [0.9, 6.6]);
    expect(slid).not.toEqual([0.2, 5.6]);
    expect(isWalkable(layout, slid)).toBe(true);
  });

  it("walks toward a target and reports arrival", () => {
    let p: readonly [number, number] = layout.spawn;
    const home = layout.zones[1];
    let done = false;
    for (let i = 0; i < 400 && !done; i++) {
      const s = stepToward(layout, p, home.center, 0.2);
      p = s.next;
      done = s.done;
    }
    expect(done).toBe(true);
    expect(Math.hypot(p[0] - home.center[0], p[1] - home.center[1])).toBeLessThan(0.5);
  });

  it("finds the nearest resident Anima", () => {
    const home = layout.zones[2];
    const stand = animaStandPoint(home);
    expect(nearestAnima(layout, animas, stand)?.anima.id).toBe(home.animaId);
    expect(nearestAnima(layout, animas, [0, 0])).toBeNull();
    // Walking up via the minimap stops in front of them, still in range and on the platform.
    const ap = approachPoint(home);
    expect(isWalkable(layout, ap)).toBe(true);
    expect(nearestAnima(layout, animas, ap)?.anima.id).toBe(home.animaId);
    expect(Math.hypot(ap[0] - stand[0], ap[1] - stand[1])).toBeCloseTo(1.4);
  });
});

describe("toWorldAnimas", () => {
  it("keeps rows with ids and defaults names", () => {
    const out = toWorldAnimas([{ id: "x", name: " Serenity " }, { id: "y" }, { name: "no id" }, null]);
    expect(out.map((a) => [a.id, a.name])).toEqual([["x", "Serenity"], ["y", "Anima"]]);
    expect(toWorldAnimas(undefined)).toEqual([]);
  });
});
