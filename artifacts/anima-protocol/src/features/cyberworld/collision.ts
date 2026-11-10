/**
 * Keep the player on platforms and walkways. Everything is 2D (XZ plane):
 * zones are discs, paths are capsules (segment + half width).
 */
import { pathEndpoints, zoneHalfExtents, zoneShape, type Vec2, type WorldLayout, type WorldAnima, type Zone } from "./layout";

/** Distance from point p to segment ab. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const len2 = abx * abx + abz * abz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2));
  const dx = p[0] - (a[0] + abx * t);
  const dz = p[1] - (a[1] + abz * t);
  return Math.hypot(dx, dz);
}

/** True when p (with a body radius of `margin`) is inside zone z. */
export function inZone(z: Zone, p: Vec2, margin = 0): boolean {
  if (zoneShape(z) === "rect") {
    const [hx, hz] = zoneHalfExtents(z);
    return Math.abs(p[0] - z.center[0]) <= hx - margin && Math.abs(p[1] - z.center[1]) <= hz - margin;
  }
  return Math.hypot(p[0] - z.center[0], p[1] - z.center[1]) <= z.radius - margin;
}

/** True when p (with a body radius of `margin`) stands fully on a zone or path. */
export function isWalkable(layout: WorldLayout, p: Vec2, margin = 0.3): boolean {
  for (const z of layout.zones) {
    if (inZone(z, p, margin)) return true;
  }
  for (const path of layout.paths) {
    const ends = pathEndpoints(layout, path);
    if (ends && distanceToSegment(p, ends[0], ends[1]) <= path.width / 2 - margin) return true;
  }
  return false;
}

/**
 * Move from `from` toward `to`; if `to` is off the network, slide along one
 * axis (so walking into a rail glides instead of sticking), else stay put.
 */
export function resolveMove(layout: WorldLayout, from: Vec2, to: Vec2, margin = 0.3): Vec2 {
  if (isWalkable(layout, to, margin)) return to;
  const slideX: Vec2 = [to[0], from[1]];
  if (isWalkable(layout, slideX, margin)) return slideX;
  const slideZ: Vec2 = [from[0], to[1]];
  if (isWalkable(layout, slideZ, margin)) return slideZ;
  return from;
}

/** Where an Anima stands inside its homepage (slightly behind centre). */
export function animaStandPoint(zone: Zone): Vec2 {
  const len = Math.hypot(zone.center[0], zone.center[1]) || 1;
  // Push outward from the hub so the player approaches face-to-face.
  const k = 0.35 * zone.radius;
  return [zone.center[0] + (zone.center[0] / len) * k, zone.center[1] + (zone.center[1] / len) * k];
}

/** Where to stop when walking up to a resident: just in front of them, on the hub side. */
export function approachPoint(zone: Zone, gap = 1.4): Vec2 {
  const [sx, sz] = animaStandPoint(zone);
  const len = Math.hypot(sx, sz) || 1;
  return [sx - (sx / len) * gap, sz - (sz / len) * gap];
}

/** Nearest resident Anima within `radius` of p, or null. */
export function nearestAnima(
  layout: WorldLayout,
  animas: readonly WorldAnima[],
  p: Vec2,
  radius = 2.6,
): { anima: WorldAnima; zone: Zone; distance: number } | null {
  let best: { anima: WorldAnima; zone: Zone; distance: number } | null = null;
  for (const zone of layout.zones) {
    if (zone.kind !== "home" || !zone.animaId) continue;
    const anima = animas.find((a) => a.id === zone.animaId);
    if (!anima) continue;
    const s = animaStandPoint(zone);
    const d = Math.hypot(p[0] - s[0], p[1] - s[1]);
    if (d <= radius && (!best || d < best.distance)) best = { anima, zone, distance: d };
  }
  return best;
}

/**
 * One step toward a click-to-move target. Returns the next position and
 * whether the target was reached (or is unreachable from here).
 */
export function stepToward(
  layout: WorldLayout,
  from: Vec2,
  target: Vec2,
  maxStep: number,
): { next: Vec2; done: boolean } {
  const dx = target[0] - from[0];
  const dz = target[1] - from[1];
  const dist = Math.hypot(dx, dz);
  if (dist <= maxStep) {
    const next = resolveMove(layout, from, target);
    return { next, done: true };
  }
  const want: Vec2 = [from[0] + (dx / dist) * maxStep, from[1] + (dz / dist) * maxStep];
  const next = resolveMove(layout, from, want);
  const stuck = next[0] === from[0] && next[1] === from[1];
  return { next, done: stuck };
}

/** The zone p stands in (first match), or null when on a path / off the network. */
export function zoneContaining(layout: WorldLayout, p: Vec2, margin = 0): Zone | null {
  return layout.zones.find((z) => inZone(z, p, margin)) ?? null;
}

/** Zones a point "belongs to" for routing: its zone, else both ends of the path it is on. */
function anchorZones(layout: WorldLayout, p: Vec2): string[] {
  const z = zoneContaining(layout, p);
  if (z) return [z.id];
  const ids: string[] = [];
  for (const path of layout.paths) {
    const ends = pathEndpoints(layout, path);
    if (ends && distanceToSegment(p, ends[0], ends[1]) <= path.width / 2) ids.push(path.from, path.to);
  }
  return [...new Set(ids)];
}

/**
 * Waypoints from `from` to `to` that stay on the network: hop zone centre to
 * zone centre along paths (zones and path capsules are convex, so each
 * straight leg stays walkable). Shortest by distance (Dijkstra over the tiny
 * zone graph). Returns [] when `to` is unreachable or off the network.
 */
export function planRoute(layout: WorldLayout, from: Vec2, to: Vec2): Vec2[] {
  const starts = anchorZones(layout, from);
  const goals = new Set(anchorZones(layout, to));
  if (!starts.length || !goals.size) return [];
  const fromZone = zoneContaining(layout, from);
  if (fromZone && goals.has(fromZone.id) && zoneContaining(layout, to)?.id === fromZone.id) return [to];

  const centre = new Map(layout.zones.map((z) => [z.id, z.center]));
  const adj = new Map<string, string[]>();
  for (const p of layout.paths) {
    if (!centre.has(p.from) || !centre.has(p.to)) continue;
    adj.set(p.from, [...(adj.get(p.from) ?? []), p.to]);
    adj.set(p.to, [...(adj.get(p.to) ?? []), p.from]);
  }
  const d = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const open = new Set<string>();
  for (const s of starts) {
    const c = centre.get(s);
    if (!c) continue;
    dist.set(s, d(from, c));
    open.add(s);
  }
  while (open.size) {
    let cur = "";
    let best = Infinity;
    for (const id of open) {
      const v = dist.get(id) ?? Infinity;
      if (v < best) {
        best = v;
        cur = id;
      }
    }
    open.delete(cur);
    for (const nb of adj.get(cur) ?? []) {
      const nd = best + d(centre.get(cur)!, centre.get(nb)!);
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd);
        prev.set(nb, cur);
        open.add(nb);
      }
    }
  }
  let goal = "";
  let goalCost = Infinity;
  for (const g of goals) {
    const c = centre.get(g);
    const v = (dist.get(g) ?? Infinity) + (c ? d(c, to) : Infinity);
    if (v < goalCost) {
      goalCost = v;
      goal = g;
    }
  }
  if (!goal || !Number.isFinite(goalCost)) return [];
  const chain: string[] = [goal];
  while (prev.has(chain[0])) chain.unshift(prev.get(chain[0])!);
  return [...chain.map((id) => centre.get(id)!), to];
}
