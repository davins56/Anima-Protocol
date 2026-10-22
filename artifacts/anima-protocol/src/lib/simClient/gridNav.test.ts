import { describe, expect, it } from "vitest";
import { createSim, type SimState } from "@workspace/sim-core";
import { actionsForPanelTap, pathTo, standable } from "./gridNav";
import { dissolveFor, unitPose } from "./wSpace";

const sim = (): SimState => createSim({ seed: 3, companionId: "serenity", startW: 60, enemies: [{ kind: "mettaur", band: "data" }], memoryPool: [] });

describe("grid collision", () => {
  it("player half only, broken panels are not standable", () => {
    const s = sim();
    expect(standable(s, 2, 2, 1)).toBe(true);
    expect(standable(s, 2, 3, 1)).toBe(false);
    s.panels[2][1][2].kind = "broken";
    expect(standable(s, 2, 2, 1)).toBe(false);
  });
  it("paths route around broken panels", () => {
    const s = sim();
    s.panels[2][1][1].kind = "broken";
    s.units[0].col = 0;
    const path = pathTo(s, 2, { col: 0, row: 1 }, { col: 2, row: 1 })!;
    expect(path).toHaveLength(4);
    expect(path.every((a) => a.t === "move")).toBe(true);
    expect(pathTo(s, 2, { col: 0, row: 1 }, { col: 1, row: 1 })).toBeNull();
  });
  it("enemy-half taps line up the row and fire", () => {
    const s = sim();
    expect(actionsForPanelTap(s, 2, 4, 0)).toEqual([{ t: "move", dc: 0, dr: -1 }, { t: "buster" }]);
    expect(actionsForPanelTap(s, 1, 1, 1)).toEqual([]); // other layer
  });
});

describe("W-space interpolation", () => {
  it("slides between layer planes and dissolves fully at mid-shift", () => {
    const a = sim();
    const b = structuredClone(a);
    b.tick = 10;
    b.units[0].phase = { fromW: 60, toW: 81.5, startTick: 0, landTick: 20, portalId: null };
    const prev = structuredClone(b);
    prev.tick = 9;
    const pose = unitPose(prev, b, 1, "navi")!;
    expect(pose.progress).toBeCloseTo(0.5);
    expect(pose.dissolve).toBeCloseTo(1);
    expect(pose.planeW).toBeGreaterThan(60);
    expect(pose.planeW).toBeLessThan(81.5);
    expect(dissolveFor(0)).toBe(0);
    expect(dissolveFor(1)).toBe(0);
    expect(dissolveFor(null)).toBe(0);
  });
});
