/**
 * Cyberworld layout as data: zones (walkable platforms) and data paths
 * (walkable walkways between zone centres). Pure — no three.js — so the same
 * description drives rendering, collision and tests.
 */

export type Vec2 = readonly [x: number, z: number];

export type ZoneKind = "hub" | "home";

export type Zone = {
  id: string;
  kind: ZoneKind;
  label: string;
  center: Vec2;
  /** Walkable radius of the (hexagonal-looking, circular for collision) platform. */
  radius: number;
  color: string;
  /** Anima that lives in this homepage, when kind === "home". */
  animaId?: string;
};

export type DataPath = {
  id: string;
  from: string;
  to: string;
  width: number;
};

export type WorldLayout = {
  zones: Zone[];
  paths: DataPath[];
  spawn: Vec2;
};

export type WorldAnima = {
  id: string;
  name: string;
  color?: string;
  /** True for fallback/demo residents that have no real record behind them. */
  mock?: boolean;
  /** Original store row (Anima / Character), kept for Talk / Customise actions. */
  record?: Record<string, unknown>;
};

export const HUB_RADIUS = 6;
export const HOME_RADIUS = 3.6;
export const HOME_RING_RADIUS = 17;
export const PATH_WIDTH = 1.6;
export const RING_PATH_WIDTH = 1.2;
export const MAX_HOMES = 8;

/** Battle Network-ish palette, anchored on the design-token protocol cyan. */
export const HOME_COLORS = ["#00EAFF", "#8B5CF6", "#14B8A6", "#FACC15", "#F472B6", "#60A5FA", "#F59E0B", "#34D399"] as const;

export function homeZoneId(animaId: string): string {
  return `home:${animaId}`;
}

/**
 * Hub plaza at the origin, one homepage per Anima evenly spaced on a ring,
 * a spoke path from the hub to every home, and (with 3+ homes) a ring path
 * linking neighbouring homes so the network reads as a network.
 */
export function buildWorldLayout(animas: readonly WorldAnima[]): WorldLayout {
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

  const paths: DataPath[] = homes.map((h) => ({ id: `spoke:${h.id}`, from: hub.id, to: h.id, width: PATH_WIDTH }));
  if (homes.length >= 3) {
    homes.forEach((h, i) => {
      const next = homes[(i + 1) % homes.length];
      paths.push({ id: `ring:${h.id}`, from: h.id, to: next.id, width: RING_PATH_WIDTH });
    });
  }

  return { zones: [hub, ...homes], paths, spawn: [0, HUB_RADIUS * 0.55] };
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

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
