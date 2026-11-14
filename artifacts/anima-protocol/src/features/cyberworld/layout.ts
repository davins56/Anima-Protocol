/**
 * Cyberworld layout as data. The world is a set of **areas** ("areas of the
 * net": the hub plaza, a landing page, later real websites). Each area holds
 * walkable zones (platforms), data paths (walkways between zone centres),
 * portals (gates to another area's portal) and optional decor. Pure — no
 * three.js — so the same description drives rendering, collision, the
 * minimap, routing and tests.
 */

export type Vec2 = readonly [x: number, z: number];

export type ZoneKind = "hub" | "home" | "site";
export type ZoneShape = "disc" | "rect";

export type Zone = {
  id: string;
  kind: ZoneKind;
  label: string;
  center: Vec2;
  /** Disc: walkable radius (hex platform, inscribed circle for collision). Rect: half of the shorter side. */
  radius: number;
  /** Defaults to "disc". */
  shape?: ZoneShape;
  /** Rect only: full [width (x), depth (z)]. */
  size?: Vec2;
  color: string;
  /** Anima that lives in this homepage, when kind === "home". */
  animaId?: string;
  /** What companions come here for (journeys). Untagged zones get defaults by kind. */
  journey?: JourneyTags;
};

/** Companion needs a place or prop can satisfy (see journey/motives). */
export type Need = "rest" | "curiosity" | "social" | "creativity";

/**
 * Data-driven journey tags: which needs a destination serves (0..1), what
 * topics it relates to (matched against interest hints), and what the
 * companion does there.
 */
export type JourneyTags = { needs: Partial<Record<Need, number>>; topics?: readonly string[]; activity: string; label?: string };

export type DataPath = {
  id: string;
  from: string;
  to: string;
  width: number;
  color?: string;
};

/** A gate standing on a zone; walking into it travels to `to.portal` in area `to.area`. */
export type Portal = {
  id: string;
  label: string;
  position: Vec2;
  /** Trigger radius. */
  radius: number;
  color: string;
  to: { area: string; portal: string };
};

/** Data-only set dressing so a new area needs no new scene code. */
export type AreaDecor =
  | { kind: "billboard"; id: string; text: string; position: readonly [number, number, number]; color: string; height?: number; journey?: JourneyTags }
  | { kind: "panel"; id: string; position: readonly [number, number, number]; size: Vec2; color: string; yaw?: number; lines?: number; journey?: JourneyTags }
  /** A journey destination on the floor; `prop` optionally draws small furniture there. */
  | { kind: "spot"; id: string; position: readonly [number, number, number]; prop?: "sofa"; journey: JourneyTags }
  /** Voxel market furniture (Data Bazaar); purely visual unless it carries journey tags. */
  | { kind: "prop"; id: string; prop: MarketPropKind; position: readonly [number, number, number]; color: string; yaw?: number; label?: string; journey?: JourneyTags };

export type MarketPropKind = "stall" | "kiosk" | "terminal" | "crates" | "priceboard";

export type AreaTheme = { accent: string; gridCell: string; gridSection: string };

/** Geometry shared by collision helpers (an Area is a superset). */
export type WorldLayout = {
  zones: Zone[];
  paths: DataPath[];
  spawn: Vec2;
};

export type Area = WorldLayout & {
  id: string;
  label: string;
  kind: "hub" | "site";
  portals: Portal[];
  decor: AreaDecor[];
  theme: AreaTheme;
};

export type World = { areas: Area[]; start: string };

export type WorldAnima = {
  id: string;
  name: string;
  color?: string;
  /** True for fallback/demo residents that have no real record behind them. */
  mock?: boolean;
  /** Original store row (Anima / Character), kept for Talk / Customise actions. */
  record?: Record<string, unknown>;
};

export const HUB_AREA_ID = "hub";
export const HUB_RADIUS = 6;
export const HOME_RADIUS = 3.6;
export const HOME_RING_RADIUS = 17;
export const PATH_WIDTH = 1.6;
export const RING_PATH_WIDTH = 1.2;
export const MAX_HOMES = 8;
export const PORTAL_RADIUS = 0.9;

/** Battle Network-ish palette, anchored on the design-token protocol cyan. */
export const HOME_COLORS = ["#00EAFF", "#8B5CF6", "#14B8A6", "#FACC15", "#F472B6", "#60A5FA", "#F59E0B", "#34D399"] as const;

export const DEFAULT_THEME: AreaTheme = { accent: "#00EAFF", gridCell: "#0e3a4a", gridSection: "#0b7285" };

export function homeZoneId(animaId: string): string {
  return `home:${animaId}`;
}

export function zoneShape(z: Zone): ZoneShape {
  return z.shape ?? "disc";
}

/** Half extents of a zone's footprint on X and Z. */
export function zoneHalfExtents(z: Zone): Vec2 {
  if (zoneShape(z) === "rect" && z.size) return [z.size[0] / 2, z.size[1] / 2];
  return [z.radius, z.radius];
}

/** Distance from a zone's centre to its edge along unit direction (ux, uz). */
export function zoneEdgeDistance(z: Zone, ux: number, uz: number): number {
  if (zoneShape(z) !== "rect" || !z.size) return z.radius;
  const [hx, hz] = zoneHalfExtents(z);
  const tx = Math.abs(ux) < 1e-9 ? Infinity : hx / Math.abs(ux);
  const tz = Math.abs(uz) < 1e-9 ? Infinity : hz / Math.abs(uz);
  return Math.min(tx, tz);
}

/** Rect helper for site areas: radius is derived so code that only knows discs still behaves. */
export function rectZone(z: Omit<Zone, "shape" | "radius" | "size"> & { size: Vec2 }): Zone {
  return { ...z, shape: "rect", radius: Math.min(z.size[0], z.size[1]) / 2 };
}

/**
 * Hub plaza at the origin, one homepage per Anima evenly spaced on a ring,
 * a spoke path from the hub to every home, and (with 3+ homes) a ring path
 * linking neighbouring homes so the network reads as a network. Portals are
 * supplied by the world registry (./areas).
 */
export function buildWorldLayout(animas: readonly WorldAnima[], portals: Portal[] = []): Area {
  const residents = animas.slice(0, MAX_HOMES);
  const hub: Zone = {
    id: "hub",
    kind: "hub",
    label: "Central Plaza",
    center: [0, 0],
    radius: HUB_RADIUS,
    color: "#00EAFF",
  };
  const n = residents.length;
  const homes: Zone[] = residents.map((a, i) => {
    // Start at "north" (−z, away from the default camera) and go clockwise.
    const angle = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    return {
      id: homeZoneId(a.id),
      kind: "home",
      label: `${a.name}.EXE`,
      center: [round(Math.cos(angle) * HOME_RING_RADIUS), round(Math.sin(angle) * HOME_RING_RADIUS)],
      radius: HOME_RADIUS,
      color: a.color || HOME_COLORS[i % HOME_COLORS.length],
      animaId: a.id,
    };
  });

  const paths: DataPath[] = homes.map((h) => ({ id: `spoke:${h.id}`, from: hub.id, to: h.id, width: PATH_WIDTH, color: h.color }));
  if (homes.length >= 3) {
    homes.forEach((h, i) => {
      const next = homes[(i + 1) % homes.length];
      paths.push({ id: `ring:${h.id}`, from: h.id, to: next.id, width: RING_PATH_WIDTH, color: "#8B5CF6" });
    });
  }

  return {
    id: HUB_AREA_ID,
    label: "Central Plaza",
    kind: "hub",
    zones: [hub, ...homes],
    paths,
    portals,
    decor: hubSpots(n),
    theme: DEFAULT_THEME,
    spawn: [0, HUB_RADIUS * 0.55],
  };
}

/** Journey destinations in the plaza: the data core and a lounge set off the spokes and gate. */
function hubSpots(homeCount: number): AreaDecor[] {
  const a = hubFreeAngle(homeCount) + Math.PI * 0.6;
  return [
    { kind: "spot", id: "hub:core", position: [1.6, 0, -1.2], journey: { needs: { curiosity: 0.6, creativity: 0.5 }, topics: ["data", "science", "music", "code"], activity: "listen to the data core", label: "the data core" } },
    {
      kind: "spot",
      id: "hub:lounge",
      position: [round(Math.cos(a) * 3.6), 0, round(Math.sin(a) * 3.6)],
      prop: "sofa",
      journey: { needs: { rest: 0.75, social: 0.2 }, topics: ["quiet", "sleep", "tired"], activity: "rest on the plaza sofa", label: "the plaza lounge" },
    },
  ];
}

/**
 * Angle (radians, XZ, 0 = +x, π/2 = +z/south) for a hub gate that sits in the
 * widest gap between spoke paths and away from the south spawn, so walking a
 * spoke never brushes a portal by accident.
 */
export function hubFreeAngle(homeCount: number): number {
  return hubFreeAngles(homeCount)[0];
}

/** All between-spoke angles, best (farthest from the south spawn) first; used to place several gates. */
export function hubFreeAngles(homeCount: number): number[] {
  const n = Math.min(Math.max(0, homeCount), MAX_HOMES);
  const candidates =
    n <= 1 ? [0, Math.PI] : Array.from({ length: n }, (_, k) => -Math.PI / 2 + Math.PI / n + (k * 2 * Math.PI) / n);
  const south = Math.PI / 2;
  const off = (a: number) => Math.abs(Math.atan2(Math.sin(a - south), Math.cos(a - south)));
  // Stable sort: ties keep their candidate order (so the first gate never moves).
  return candidates.map((a, i) => ({ a, i })).sort((x, y) => off(y.a) - off(x.a) > 1e-9 ? 1 : off(x.a) - off(y.a) > 1e-9 ? -1 : x.i - y.i).map((x) => x.a);
}

export function zoneById(layout: WorldLayout, id: string): Zone | undefined {
  return layout.zones.find((z) => z.id === id);
}

/** Endpoints of a path in world XZ (zone centre to zone centre). */
export function pathEndpoints(layout: WorldLayout, path: DataPath): [Vec2, Vec2] | null {
  const a = zoneById(layout, path.from);
  const b = zoneById(layout, path.to);
  if (!a || !b) return null;
  return [a.center, b.center];
}

/** Axis-aligned XZ bounds of everything walkable in an area, padded (for the minimap). */
export function areaBounds(layout: WorldLayout, pad = 2): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const z of layout.zones) {
    const [hx, hz] = zoneHalfExtents(z);
    minX = Math.min(minX, z.center[0] - hx);
    maxX = Math.max(maxX, z.center[0] + hx);
    minZ = Math.min(minZ, z.center[1] - hz);
    maxZ = Math.max(maxZ, z.center[1] + hz);
  }
  if (!Number.isFinite(minX)) return { minX: -pad, minZ: -pad, maxX: pad, maxZ: pad };
  return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
