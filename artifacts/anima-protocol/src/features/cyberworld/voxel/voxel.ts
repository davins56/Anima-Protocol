/**
 * Voxel diorama look, as pure data. Each area's walkable zones become the
 * rooftops of neon tower blocks: a 1-unit voxel grid covers every zone plus a
 * non-walkable "roof band" where props live (so the player never walks through
 * furniture), rim cells grow down into window-lit tower columns with a lower
 * setback tier, and a deterministic skyline rings the area.
 *
 * Gameplay geometry (zones, paths, collision, routing) is untouched: this
 * module only reads an Area and returns boxes for the renderer, so it is cheap
 * to test and every part can be drawn with a handful of instanced meshes.
 */
import { distanceToSegment, inZone, isWalkable } from "../collision";
import { hashString, mulberry32 } from "../explore/rng";
import { areaBounds, pathEndpoints, zoneHalfExtents, zoneShape, type Area, type Vec2, type Zone } from "../layout";

/** Voxel edge length (world units). */
export const VOXEL = 1;
/** Non-walkable rooftop margin around each zone, where props stand. */
export const ROOF_BAND = 2.6;
/** How far tower columns reach below the walkable roof (y = 0). */
export const TOWER_DEPTH = 26;
/** Top of the wider lower tier ("setback") under each rooftop. */
export const SETBACK_Y = -5;

export type Vec3 = [number, number, number];
/** One axis-aligned box: centre, size and colour. */
export type VoxelBox = { p: Vec3; s: Vec3; color: string };

export type RoofCell = {
  x: number;
  z: number;
  /** Zone that owns this cell (first claimer). */
  zoneId: string;
  /** Walkable: on a zone or a walkway corridor. */
  walk: boolean;
  /** On a walkway corridor (keeps props and parapets off the way in). */
  corridor: boolean;
  /** Outer edge of the area's rooftop union. */
  rim: boolean;
  /** Walkable cell touching the band: gets a neon inlay. */
  edge: boolean;
};

export type SkylineTower = { x: number; z: number; w: number; d: number; top: number; variant: number; cap: string | null; sign: string | null };

export type VoxelArea = {
  cells: RoofCell[];
  /** Tower walls under rim cells (tops at y = 0 minus the roof slab). */
  columns: { x: number; z: number; variant: number }[];
  /** Lower, wider tier cells around each rooftop. */
  setback: { x: number; z: number; variant: number }[];
  /** Dark solid prop parts (desks, racks, parapets, crates…). */
  solids: VoxelBox[];
  /** Emissive prop parts (screens, lamps, neon strips, inlays). */
  glows: VoxelBox[];
};

export const NEON = {
  orange: "#FF9A3C",
  amber: "#FFC76B",
  pink: "#FF4FA3",
  cyan: "#39E6FF",
  violet: "#A78BFA",
  lime: "#7CFFB2",
} as const;

const SOLID = { body: "#2A2147", dark: "#1A1530", wood: "#3B2A55", chair: "#4B3A78", plant: "#1F9D6B" } as const;

const key = (x: number, z: number) => `${x},${z}`;
const N4: readonly Vec2[] = [[VOXEL, 0], [-VOXEL, 0], [0, VOXEL], [0, -VOXEL]];
/** Centre of the voxel cell containing v. */
export const cellCentre = (v: number) => Math.floor(v / VOXEL) * VOXEL + VOXEL / 2;

/** Zone grown by `band` on every side (used for the roof footprint). */
export function roofZone(zone: Zone, band = ROOF_BAND): Zone {
  if (zoneShape(zone) === "rect" && zone.size) {
    return { ...zone, size: [zone.size[0] + band * 2, zone.size[1] + band * 2], radius: zone.radius + band };
  }
  return { ...zone, radius: zone.radius + band };
}

function corridorDistance(area: Area, p: Vec2): number {
  let best = Infinity;
  for (const path of area.paths) {
    const ends = pathEndpoints(area, path);
    if (!ends) continue;
    best = Math.min(best, distanceToSegment(p, ends[0], ends[1]) - path.width / 2);
  }
  return best;
}

function onCorridor(area: Area, p: Vec2, pad = 0): boolean {
  return corridorDistance(area, p) <= pad;
}

function nearPortal(area: Area, p: Vec2, pad: number): boolean {
  return area.portals.some((g) => Math.hypot(p[0] - g.position[0], p[1] - g.position[1]) <= g.radius + pad);
}

/** Every rooftop cell of an area (union of all zones' roofs). */
export function roofCells(area: Area, band = ROOF_BAND): RoofCell[] {
  const map = new Map<string, RoofCell>();
  for (const zone of area.zones) {
    const roof = roofZone(zone, band);
    const [hx, hz] = zoneHalfExtents(roof);
    for (let x = cellCentre(zone.center[0] - hx); x <= zone.center[0] + hx; x += VOXEL) {
      for (let z = cellCentre(zone.center[1] - hz); z <= zone.center[1] + hz; z += VOXEL) {
        const p: Vec2 = [x, z];
        if (!inZone(roof, p)) continue;
        const k = key(x, z);
        const corridor = onCorridor(area, p, 0.25);
        const walk = area.zones.some((zz) => inZone(zz, p)) || corridor;
        const prev = map.get(k);
        if (prev) {
          prev.walk ||= walk;
          continue;
        }
        map.set(k, { x, z, zoneId: zone.id, walk, corridor, rim: false, edge: false });
      }
    }
  }
  for (const c of map.values()) {
    const ns = N4.map(([dx, dz]) => map.get(key(c.x + dx, c.z + dz)));
    c.rim = ns.some((n) => !n);
    c.edge = c.walk && !c.corridor && ns.some((n) => n && !n.walk);
  }
  return [...map.values()];
}

/** Deterministic integer variant (0..n-1) for a cell. */
export function cellVariant(x: number, z: number, n: number, salt = ""): number {
  return hashString(`${salt}${x}|${z}`) % n;
}

type PropKind = "desk" | "rack" | "planter" | "lamp" | "crates" | "screen" | "sofa";
const PROP_KINDS: readonly PropKind[] = ["desk", "desk", "desk", "rack", "planter", "lamp", "crates", "screen", "sofa"];

/** Furniture for one roof-band cell, as solid + glow boxes centred on (x, z). */
export function propBoxes(kind: PropKind, x: number, z: number, accent: string, rnd: () => number): { solids: VoxelBox[]; glows: VoxelBox[] } {
  const solids: VoxelBox[] = [];
  const glows: VoxelBox[] = [];
  const screen = rnd() < 0.5 ? NEON.cyan : rnd() < 0.5 ? NEON.orange : accent;
  switch (kind) {
    case "desk":
      solids.push({ p: [x, 0.2, z], s: [0.8, 0.4, 0.5], color: SOLID.wood });
      glows.push({ p: [x, 0.58, z - 0.12], s: [0.46, 0.3, 0.06], color: screen });
      solids.push({ p: [x, 0.17, z + 0.38], s: [0.3, 0.34, 0.3], color: SOLID.chair });
      break;
    case "rack":
      solids.push({ p: [x, 0.7, z], s: [0.6, 1.4, 0.5], color: SOLID.dark });
      for (const y of [0.35, 0.7, 1.05]) glows.push({ p: [x, y, z], s: [0.62, 0.05, 0.52], color: rnd() < 0.5 ? NEON.lime : NEON.cyan });
      break;
    case "planter":
      solids.push({ p: [x, 0.15, z], s: [0.8, 0.3, 0.8], color: SOLID.wood });
      solids.push({ p: [x, 0.55, z], s: [0.55, 0.5, 0.55], color: SOLID.plant });
      glows.push({ p: [x + 0.12, 0.88, z - 0.1], s: [0.16, 0.16, 0.16], color: NEON.pink });
      break;
    case "lamp":
      solids.push({ p: [x, 0.65, z], s: [0.1, 1.3, 0.1], color: SOLID.dark });
      glows.push({ p: [x, 1.38, z], s: [0.28, 0.28, 0.28], color: NEON.amber });
      glows.push({ p: [x, 0.006, z], s: [0.9, 0.01, 0.9], color: "#7A3A16" });
      break;
    case "crates": {
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) solids.push({ p: [x + (i % 2) * 0.12 - 0.06, 0.25 + i * 0.5, z], s: [0.5, 0.5, 0.5], color: i % 2 ? SOLID.chair : SOLID.body });
      glows.push({ p: [x, 0.5 * n + 0.03, z], s: [0.3, 0.04, 0.3], color: accent });
      break;
    }
    case "screen":
      solids.push({ p: [x, 0.55, z], s: [0.9, 1.1, 0.12], color: SOLID.dark });
      glows.push({ p: [x, 0.6, z + 0.07], s: [0.78, 0.86, 0.03], color: screen });
      break;
    case "sofa":
      solids.push({ p: [x, 0.18, z], s: [0.9, 0.36, 0.45], color: SOLID.chair });
      solids.push({ p: [x, 0.42, z - 0.17], s: [0.9, 0.3, 0.12], color: SOLID.chair });
      glows.push({ p: [x, 0.02, z], s: [1, 0.02, 0.6], color: NEON.violet });
      break;
  }
  return { solids, glows };
}

/**
 * Build everything that makes an area look like a voxel city block.
 * `accentFor` lets the hub follow the real-world biome tint.
 */
export function buildVoxelArea(area: Area, accentFor: (zone: Zone) => string = (z) => z.color): VoxelArea {
  const cells = roofCells(area);
  const zones = new Map(area.zones.map((z) => [z.id, z]));
  const solids: VoxelBox[] = [];
  const glows: VoxelBox[] = [];
  const columns: VoxelArea["columns"] = [];
  const occupied = new Set(cells.map((c) => key(c.x, c.z)));
  const byKey = new Map(cells.map((c) => [key(c.x, c.z), c]));

  for (const c of cells) {
    const zone = zones.get(c.zoneId)!;
    const accent = accentFor(zone);
    const p: Vec2 = [c.x, c.z];
    if (c.rim) columns.push({ x: c.x, z: c.z, variant: cellVariant(c.x, c.z, 3, area.id) });
    if (c.edge) {
      // Stepped neon outline of the walkable floor: a thin strip on each side that faces the band.
      for (const [dx, dz] of N4) {
        const n = byKey.get(key(c.x + dx, c.z + dz));
        if (!n || n.walk) continue;
        glows.push({ p: [c.x + dx * 0.46, 0.015, c.z + dz * 0.46], s: [dx ? 0.08 : VOXEL, 0.03, dz ? 0.08 : VOXEL], color: accent });
      }
    }
    if (c.walk) continue;
    // Props keep ~0.9 of air from anything walkable so the player's body never clips them.
    const clear = !onCorridor(area, p, 0.9) && !nearPortal(area, p, 1) && !isWalkable(area, p, -0.9);
    if (c.rim) {
      if (!clear) continue;
      // Low parapet with a neon cap, the roof's outline.
      solids.push({ p: [c.x, 0.2, c.z], s: [VOXEL, 0.4, VOXEL], color: SOLID.body });
      for (const [dx, dz] of N4) {
        if (byKey.has(key(c.x + dx, c.z + dz))) continue;
        // Neon trim along the outside top edge only, so the outline steps cleanly.
        glows.push({ p: [c.x + dx * 0.47, 0.42, c.z + dz * 0.47], s: [dx ? 0.08 : VOXEL + 0.02, 0.06, dz ? 0.08 : VOXEL + 0.02], color: accent });
      }
      continue;
    }
    if (!clear) continue;
    const rnd = mulberry32(hashString(`${area.id}|prop|${c.x}|${c.z}`));
    if (rnd() > 0.62) {
      // Empty band cells get the odd floor light so the roof never reads as dead space.
      if (rnd() < 0.3) glows.push({ p: [c.x, 0.012, c.z], s: [0.4, 0.02, 0.4], color: rnd() < 0.5 ? NEON.orange : accent });
      continue;
    }
    const kind = PROP_KINDS[Math.floor(rnd() * PROP_KINDS.length)];
    const part = propBoxes(kind, c.x, c.z, accent, rnd);
    solids.push(...part.solids);
    glows.push(...part.glows);
  }

  // Setback tier: one or two cells wider than the roof, a few storeys down.
  const setback: VoxelArea["setback"] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    if (!c.rim) continue;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const x = c.x + dx * VOXEL;
        const z = c.z + dz * VOXEL;
        const k = key(x, z);
        if (occupied.has(k) || seen.has(k)) continue;
        seen.add(k);
        setback.push({ x, z, variant: cellVariant(x, z, 3, `${area.id}|sb`) });
      }
    }
  }
  return { cells, columns, setback, solids, glows };
}

/**
 * Background city: towers on rings around the area. Near towers stay well
 * below the roofs so they never block the diorama camera; far ones rise above
 * it for the skyline silhouette. Deterministic per area.
 */
export function buildSkyline(area: Area, count: number): SkylineTower[] {
  const b = areaBounds(area, 0);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const reach = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + ROOF_BAND + 4;
  const rnd = mulberry32(hashString(`${area.id}|skyline`));
  const towers: SkylineTower[] = [];
  const caps = [NEON.pink, NEON.cyan, NEON.orange, NEON.violet];
  let guard = 0;
  while (towers.length < count && guard++ < count * 20) {
    const a = rnd() * Math.PI * 2;
    const r = reach + 4 + Math.pow(rnd(), 0.8) * 70;
    const x = Math.round(cx + Math.cos(a) * r);
    const z = Math.round(cz + Math.sin(a) * r);
    const w = 3 + Math.floor(rnd() * 4);
    const d = 3 + Math.floor(rnd() * 4);
    if (towers.some((t) => Math.abs(t.x - x) < (t.w + w) / 2 + 0.6 && Math.abs(t.z - z) < (t.d + d) / 2 + 0.6)) continue;
    // Height grows with distance: low blocks hug the rooftops, tall ones frame the horizon.
    const k = Math.min(1, (r - reach) / 60);
    const top = Math.round(-16 + k * 34 * (0.4 + rnd() * 0.8) - (r < reach + 14 ? 6 : 0));
    towers.push({
      x,
      z,
      w,
      d,
      top,
      variant: Math.floor(rnd() * 3),
      cap: rnd() < 0.35 ? caps[Math.floor(rnd() * caps.length)] : null,
      sign: rnd() < 0.18 ? caps[Math.floor(rnd() * caps.length)] : null,
    });
  }
  return towers;
}

/** Fill-in towers under the gaps between rooftops (below the walkways). */
export function buildUnderCity(area: Area): SkylineTower[] {
  const b = areaBounds(area, ROOF_BAND + 2);
  const rnd = mulberry32(hashString(`${area.id}|under`));
  const roofs = area.zones.map((z) => roofZone(z, ROOF_BAND + 1.5));
  const out: SkylineTower[] = [];
  for (let x = Math.floor(b.minX); x < b.maxX; x += 6) {
    for (let z = Math.floor(b.minZ); z < b.maxZ; z += 6) {
      if (rnd() < 0.35) continue;
      const w = 3 + Math.floor(rnd() * 3);
      const d = 3 + Math.floor(rnd() * 3);
      const px = x + 3, pz = z + 3;
      const r = Math.hypot(w, d) / 2;
      if (roofs.some((zz) => inZone({ ...zz, radius: zz.radius + r, size: zz.size ? [zz.size[0] + 2 * r, zz.size[1] + 2 * r] : zz.size }, [px, pz]))) continue;
      out.push({ x: px, z: pz, w, d, top: -9 - Math.floor(rnd() * 10), variant: Math.floor(rnd() * 3), cap: null, sign: rnd() < 0.2 ? NEON.orange : null });
    }
  }
  return out;
}

/**
 * Window pattern for a tower texture (column-major lit flags), deterministic.
 * `cols` windows across, `rows` storeys; ~`lit` of them glow.
 */
export function windowPattern(seed: string, cols: number, rows: number, lit = 0.28): (string | null)[] {
  const rnd = mulberry32(hashString(seed));
  const colors = [NEON.orange, NEON.amber, NEON.amber, NEON.pink, NEON.cyan];
  const out: (string | null)[] = [];
  for (let i = 0; i < cols * rows; i++) out.push(rnd() < lit ? colors[Math.floor(rnd() * colors.length)] : null);
  return out;
}
