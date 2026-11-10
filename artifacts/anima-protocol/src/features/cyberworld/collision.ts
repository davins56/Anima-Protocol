/**
 * Keep the player on platforms and walkways. Everything is 2D (XZ plane):
 * zones are discs, paths are capsules (segment + half width).
 */
import { pathEndpoints, type Vec2, type WorldLayout, type WorldAnima, type Zone } from "./layout";

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

/** True when p (with a body radius of `margin`) stands fully on a zone or path. */
export function isWalkable(layout: WorldLayout, p: Vec2, margin = 0.3): boolean {
  for (const z of layout.zones) {
    if (Math.hypot(p[0] - z.center[0], p[1] - z.center[1]) <= z.radius - margin) return true;
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
