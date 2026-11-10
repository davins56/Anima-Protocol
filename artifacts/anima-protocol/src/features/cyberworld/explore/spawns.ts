/**
 * Deterministic daily spawns: (region key, local day, area) seeds where
 * hidden data nodes sit and what each one holds, so the same place gives the
 * same set all day and a fresh set tomorrow.
 */
import { animaStandPoint, isWalkable } from "../collision";
import { areaBounds, type Area, type Vec2 } from "../layout";
import { rollLoot, type LootConditions, type LootDef } from "./loot";
import type { RegionContext } from "./region";
import { seededRng } from "./rng";

export type DataNode = { id: string; position: Vec2; loot: LootDef };

export const NODES_PER_AREA = 8;
const CLEARANCE = 1.6;

export function spawnSeed(region: Pick<RegionContext, "key" | "dayKey">, areaId: string): string {
  return `${region.key}|${region.dayKey}|${areaId}`;
}

/** `<region>:<day>:<area>:<n>` — region-scoped so switching location source never collides. */
export function nodeId(region: Pick<RegionContext, "key" | "dayKey">, areaId: string, n: number): string {
  return `${region.key}:${region.dayKey}:${areaId}:${n}`;
}

export function generateNodes(area: Area, region: RegionContext, count = NODES_PER_AREA): DataNode[] {
  const rng = seededRng(spawnSeed(region, area.id));
  const b = areaBounds(area, 0);
  const avoid: Vec2[] = [area.spawn, ...area.portals.map((p) => p.position), ...area.zones.filter((z) => z.animaId).map(animaStandPoint)];
  const cond: LootConditions = { biome: region.biome, timeOfDay: region.timeOfDay, weather: region.weather, season: region.season };
  const nodes: DataNode[] = [];
  const far = (p: Vec2, q: Vec2, d: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= d;
  for (let tries = 0; nodes.length < count && tries < count * 60; tries++) {
    const p: Vec2 = [b.minX + rng() * (b.maxX - b.minX), b.minZ + rng() * (b.maxZ - b.minZ)];
    if (!isWalkable(area, p, 0.5)) continue;
    if (!avoid.every((a) => far(p, a, CLEARANCE))) continue;
    if (!nodes.every((n) => far(p, n.position, 2.2))) continue;
    const loot = rollLoot(rng, cond);
    if (!loot) break;
    const rounded: Vec2 = [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
    nodes.push({ id: nodeId(region, area.id, nodes.length), position: rounded, loot });
  }
  return nodes;
}
