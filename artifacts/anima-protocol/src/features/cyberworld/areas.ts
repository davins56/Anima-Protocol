/**
 * World registry: every "area of the net" the player can travel to, and the
 * portal links between them. To add an area: write a builder that returns an
 * Area (zones/paths/portals/decor as data), add it to AREA_BUILDERS, and give
 * an existing area a portal whose `to` points at one of the new area's portals
 * (and back). `validateWorld` (run in tests) catches broken or one-way links.
 */
import { distanceToSegment, inZone, isWalkable } from "./collision";
import {
  buildWorldLayout,
  DEFAULT_THEME,
  HUB_AREA_ID,
  hubFreeAngle,
  MAX_HOMES,
  PORTAL_RADIUS,
  PATH_WIDTH,
  rectZone,
  type Area,
  type Portal,
  type Vec2,
  type World,
  type WorldAnima,
} from "./layout";

export const LANDING_AREA_ID = "landing";

export const HUB_GATE_RADIUS = 4.2;

/** Gates in the plaza, placed between spokes (see hubFreeAngle). */
function hubPortals(homeCount: number): Portal[] {
  const a = hubFreeAngle(homeCount);
  const position: Vec2 = [Math.round(Math.cos(a) * HUB_GATE_RADIUS * 1000) / 1000, Math.round(Math.sin(a) * HUB_GATE_RADIUS * 1000) / 1000];
  return [
  {
    id: "hub:to-landing",
    label: "Landing Page",
    position,
    radius: PORTAL_RADIUS,
    color: "#F472B6",
    to: { area: LANDING_AREA_ID, portal: "landing:to-hub" },
  },
  ];
}

/**
 * Placeholder "website" area: a landing page laid out as a walkable page —
 * hero section, a content strip and a footer with the gate back to the hub.
 * No real site rendering yet; decor is just neon stand-ins for page blocks.
 */
export function buildLandingArea(): Area {
  const pink = "#F472B6";
  const violet = "#8B5CF6";
  return {
    id: LANDING_AREA_ID,
    label: "Landing Page",
    kind: "site",
    theme: { accent: pink, gridCell: "#3b1030", gridSection: "#9d174d" },
    zones: [
      rectZone({ id: "landing:hero", kind: "site", label: "Hero", center: [0, -6], size: [16, 9], color: pink }),
      rectZone({ id: "landing:features", kind: "site", label: "Features", center: [0, 4], size: [14, 4], color: violet }),
      rectZone({ id: "landing:footer", kind: "site", label: "Footer", center: [0, 11], size: [9, 5], color: "#00EAFF", journey: { needs: { rest: 0.4 }, topics: ["quiet"], activity: "sit by the footer links" } }),
    ],
    paths: [
      { id: "landing:hero-features", from: "landing:hero", to: "landing:features", width: PATH_WIDTH * 1.5, color: pink },
      { id: "landing:features-footer", from: "landing:features", to: "landing:footer", width: PATH_WIDTH * 1.5, color: violet },
    ],
    portals: [
      {
        id: "landing:to-hub",
        label: "Central Plaza",
        // Off the footer centreline so the arrival camera does not look through the gate.
        position: [3, 11.4],
        radius: PORTAL_RADIUS,
        color: "#00EAFF",
        to: { area: HUB_AREA_ID, portal: "hub:to-landing" },
      },
    ],
    decor: [
      { kind: "billboard", id: "title", text: "LANDING PAGE", position: [0, 3.4, -10], color: pink, height: 1.4, journey: { needs: { curiosity: 0.8 }, topics: ["signs", "news", "construction"], activity: "read the new signs", label: "the Landing Page signs" } },
      { kind: "billboard", id: "sub", text: "area under construction", position: [0, 2.3, -10], color: "#F1F5F9", height: 0.5 },
      // nav bar
      ...[-4.5, -1.5, 1.5, 4.5].map((x, i) => ({ kind: "panel" as const, id: `nav${i}`, position: [x, 4.6, -10.2] as const, size: [2.4, 0.5] as const, color: violet, lines: 0 })),
      // hero CTA + image block
      { kind: "panel", id: "cta", position: [-3, 1.4, -7], size: [3.2, 0.9], color: pink, lines: 0 },
      { kind: "panel", id: "hero-img", position: [4, 2, -8], size: [4, 2.6], color: "#00EAFF", lines: 3, journey: { needs: { creativity: 0.8, curiosity: 0.3 }, topics: ["art", "design", "images", "photos"], activity: "sketch from the hero image", label: "the hero image" } },
      // feature cards
      ...[-4.5, 0, 4.5].map((x, i) => ({
        kind: "panel" as const,
        id: `card${i}`,
        position: [x, 1.4, 3] as const,
        size: [3, 1.8] as const,
        color: violet,
        lines: 3,
        ...(i === 1 ? { journey: { needs: { curiosity: 0.7 }, topics: ["features", "tech", "learning", "books"], activity: "read the feature panels", label: "the feature panels" } } : {}),
      })),
    ],
    spawn: [0, 9.5],
  };
}

export type AreaBuilder = (animas: readonly WorldAnima[]) => Area;

export const AREA_BUILDERS: readonly AreaBuilder[] = [(animas) => buildWorldLayout(animas, hubPortals(Math.min(animas.length, MAX_HOMES))), () => buildLandingArea()];

export function buildWorld(animas: readonly WorldAnima[]): World {
  return { areas: AREA_BUILDERS.map((b) => b(animas)), start: HUB_AREA_ID };
}

export function areaById(world: World, id: string): Area | undefined {
  return world.areas.find((a) => a.id === id);
}

/** Portal whose trigger radius contains p, or null. */
export function portalAt(area: Area, p: Vec2): Portal | null {
  return area.portals.find((g) => Math.hypot(p[0] - g.position[0], p[1] - g.position[1]) <= g.radius) ?? null;
}

/**
 * Where a traveller appears after stepping through a portal into `target`:
 * just in front of the target portal, offset toward the centre of the zone it
 * stands on, so you don't instantly bounce back.
 */
export function arrivalPoint(target: Area, portal: Portal): Vec2 {
  const zone = target.zones.find((z) => inZone(z, portal.position)) ?? target.zones[0];
  const cx = zone ? zone.center[0] : target.spawn[0];
  const cz = zone ? zone.center[1] : target.spawn[1];
  let dx = cx - portal.position[0];
  let dz = cz - portal.position[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    dx = target.spawn[0] - portal.position[0];
    dz = target.spawn[1] - portal.position[1];
  }
  const l = Math.hypot(dx, dz) || 1;
  const k = portal.radius + 1.2;
  return [portal.position[0] + (dx / l) * k, portal.position[1] + (dz / l) * k];
}

/** Resolve a portal hop: target area and arrival point, or null if the link is broken. */
export function travel(world: World, portal: Portal): { area: Area; spawn: Vec2 } | null {
  const area = areaById(world, portal.to.area);
  const dest = area?.portals.find((g) => g.id === portal.to.portal);
  if (!area || !dest) return null;
  return { area, spawn: arrivalPoint(area, dest) };
}

/** Human-readable problems with the world graph (empty = OK). */
export function validateWorld(world: World): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (!areaById(world, world.start)) errors.push(`start area "${world.start}" missing`);
  for (const area of world.areas) {
    if (ids.has(area.id)) errors.push(`duplicate area id "${area.id}"`);
    ids.add(area.id);
    if (!isWalkable(area, area.spawn)) errors.push(`${area.id}: spawn is not walkable`);
    for (const p of area.paths) {
      if (!area.zones.some((z) => z.id === p.from) || !area.zones.some((z) => z.id === p.to)) errors.push(`${area.id}: path ${p.id} references a missing zone`);
    }
    for (const g of area.portals) {
      if (!isWalkable(area, g.position, 0)) errors.push(`${area.id}: portal ${g.id} is off the network`);
      if (portalAt(area, area.spawn)) errors.push(`${area.id}: spawn sits inside portal ${g.id}`);
      for (const p of area.paths) {
        const a = area.zones.find((z) => z.id === p.from);
        const b = area.zones.find((z) => z.id === p.to);
        if (a && b && distanceToSegment(g.position, a.center, b.center) <= g.radius) errors.push(`${area.id}: portal ${g.id} sits on path ${p.id}`);
      }
      const hop = travel(world, g);
      if (!hop) {
        errors.push(`${area.id}: portal ${g.id} links to missing ${g.to.area}/${g.to.portal}`);
        continue;
      }
      const back = hop.area.portals.find((x) => x.id === g.to.portal);
      if (back && (back.to.area !== area.id || back.to.portal !== g.id)) errors.push(`${area.id}: portal ${g.id} has no matching return link`);
      if (!isWalkable(hop.area, hop.spawn)) errors.push(`${area.id}: arrival from ${g.id} is not walkable`);
      if (portalAt(hop.area, hop.spawn)) errors.push(`${area.id}: arrival from ${g.id} lands inside a portal`);
    }
  }
  return errors;
}

export { DEFAULT_THEME };
