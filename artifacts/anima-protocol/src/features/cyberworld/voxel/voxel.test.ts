import { describe, expect, it } from "vitest";
import { buildWorld } from "../areas";
import { inZone, isWalkable } from "../collision";
import { MOCK_ANIMAS } from "../mockAnimas";
import { areaBounds, type Area } from "../layout";
import { buildSkyline, buildUnderCity, buildVoxelArea, cellCentre, roofCells, roofZone, ROOF_BAND, VOXEL, windowPattern } from "./voxel";

const world = buildWorld(MOCK_ANIMAS);
const areas: Area[] = world.areas;

describe("voxel rooftops", () => {
  it.each(areas.map((a) => [a.id, a] as const))("%s: every walkable zone point sits on a walkable roof cell", (_id, area) => {
    const cells = new Map(roofCells(area).map((c) => [`${c.x},${c.z}`, c]));
    for (const zone of area.zones) {
      for (let i = 0; i < 400; i++) {
        const p: [number, number] = [zone.center[0] - zone.radius * 2 + (i % 20) * (zone.radius / 5), zone.center[1] - zone.radius * 2 + Math.floor(i / 20) * (zone.radius / 5)];
        if (!inZone(zone, p)) continue;
        const cell = cells.get(`${cellCentre(p[0])},${cellCentre(p[1])}`);
        expect(cell, `cell under ${p}`).toBeTruthy();
      }
    }
  });

  it.each(areas.map((a) => [a.id, a] as const))("%s: props stand only on the non-walkable roof band", (_id, area) => {
    const vox = buildVoxelArea(area);
    expect(vox.solids.length).toBeGreaterThan(0);
    for (const b of vox.solids) {
      const p: [number, number] = [b.p[0], b.p[2]];
      expect(isWalkable(area, p, -0.35), `prop at ${p}`).toBe(false);
      expect(area.zones.some((z) => inZone(roofZone(z, ROOF_BAND + VOXEL), p))).toBe(true);
    }
  });

  it("keeps portals and walkway mouths clear of props", () => {
    for (const area of areas) {
      const vox = buildVoxelArea(area);
      for (const b of vox.solids) {
        for (const g of area.portals) expect(Math.hypot(b.p[0] - g.position[0], b.p[2] - g.position[1])).toBeGreaterThan(g.radius + 0.5);
      }
    }
  });

  it("rim cells (tower walls) have an open side; interior cells don't", () => {
    const area = areas[0];
    const cells = roofCells(area);
    const set = new Set(cells.map((c) => `${c.x},${c.z}`));
    for (const c of cells) {
      const open = [[VOXEL, 0], [-VOXEL, 0], [0, VOXEL], [0, -VOXEL]].some(([dx, dz]) => !set.has(`${c.x + dx},${c.z + dz}`));
      expect(c.rim).toBe(open);
    }
  });

  it("is deterministic and follows the accent", () => {
    const area = areas[0];
    expect(buildVoxelArea(area)).toEqual(buildVoxelArea(area));
    const tinted = buildVoxelArea(area, (z) => (z.kind === "hub" ? "#123456" : z.color));
    expect(tinted.glows.some((g) => g.color === "#123456")).toBe(true);
  });
});

describe("skyline", () => {
  it.each(areas.map((a) => [a.id, a] as const))("%s: towers stay off the rooftops and below them nearby", (_id, area) => {
    const sky = buildSkyline(area, 160);
    expect(sky.length).toBeGreaterThan(100);
    const b = areaBounds(area, 0);
    const reach = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + ROOF_BAND + 4;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    for (const t of sky) {
      const r = Math.hypot(t.x - cx, t.z - cz);
      expect(r).toBeGreaterThan(reach);
      if (r < reach + 14) expect(t.top).toBeLessThan(-1);
    }
    expect(buildSkyline(area, 160)).toEqual(sky);
  });

  it("under-city blocks sit below the walkways and outside the rooftops", () => {
    for (const area of areas) {
      for (const t of buildUnderCity(area)) {
        expect(t.top).toBeLessThanOrEqual(-9);
        for (const z of area.zones) expect(inZone(roofZone(z), [t.x, t.z])).toBe(false);
      }
    }
  });

  it("window patterns are deterministic with roughly the requested lit share", () => {
    const a = windowPattern("x", 16, 18, 0.25);
    expect(windowPattern("x", 16, 18, 0.25)).toEqual(a);
    const lit = a.filter(Boolean).length / a.length;
    expect(lit).toBeGreaterThan(0.12);
    expect(lit).toBeLessThan(0.4);
  });
});
