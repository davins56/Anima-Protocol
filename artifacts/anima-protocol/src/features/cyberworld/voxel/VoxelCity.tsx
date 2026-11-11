/**
 * Renderer for ./voxel: rooftops, tower walls with pixel windows, a setback
 * tier, rooftop props and the background skyline. Each family is merged into
 * one static BufferGeometry (vertex colours, world-space window UVs, hidden
 * faces between neighbouring cells culled), so a whole area is ~5 draw calls
 * and window rows line up across every tower regardless of its size. Lambert
 * materials keep per-pixel cost low on phones (the city is mostly flat faces).
 */
import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Area, Zone } from "../layout";
import { buildSkyline, buildUnderCity, buildVoxelArea, SETBACK_Y, TOWER_DEPTH, VOXEL, windowPattern, type SkylineTower, type VoxelBox } from "./voxel";

export const ROOF_COLORS = { walkA: "#5A4C9E", walkB: "#51448F", band: "#2C2350", corridor: "#62539F" } as const;
const WALL = "#1F1940";
const WALL_DARK = "#120E26";
const TOP = "#241D48";
/** Street level: every tower stops here, where the haze floor hides its base (less overdraw than full-height boxes). */
export const STREET_Y = -26.5;
/** Window texture tile, in world units (repeats in world space). */
const TILE_W = 8;
const TILE_H = 12;

/* ── Geometry ──────────────────────────────────────────────────────────── */

type Face = "px" | "nx" | "py" | "ny" | "pz" | "nz";
const ALL: readonly Face[] = ["px", "nx", "py", "ny", "pz", "nz"];
const SIDES: readonly Face[] = ["px", "nx", "pz", "nz"];

type GeoBox = { p: readonly number[]; s: readonly number[]; color?: string; faces?: readonly Face[] };

/**
 * Merge boxes into one geometry. Side-face UVs are world-space (u along the
 * face, v = height) divided by the window tile, so facades tile seamlessly.
 */
export function mergeBoxes(boxes: readonly GeoBox[], defaultFaces: readonly Face[] = ALL): THREE.BufferGeometry {
  let quads = 0;
  for (const b of boxes) quads += (b.faces ?? defaultFaces).length;
  const pos = new Float32Array(quads * 12);
  const nor = new Float32Array(quads * 12);
  const uv = new Float32Array(quads * 8);
  const col = new Float32Array(quads * 12);
  const idx = new Uint32Array(quads * 6);
  const c = new THREE.Color();
  let q = 0;
  for (const b of boxes) {
    const [x, y, z] = b.p;
    const hx = b.s[0] / 2, hy = b.s[1] / 2, hz = b.s[2] / 2;
    c.set(b.color ?? "#ffffff");
    for (const f of b.faces ?? defaultFaces) {
      // Four corners, counter-clockwise seen from outside.
      let v: number[][];
      let n: number[];
      switch (f) {
        case "px": v = [[x + hx, y - hy, z + hz], [x + hx, y - hy, z - hz], [x + hx, y + hy, z - hz], [x + hx, y + hy, z + hz]]; n = [1, 0, 0]; break;
        case "nx": v = [[x - hx, y - hy, z - hz], [x - hx, y - hy, z + hz], [x - hx, y + hy, z + hz], [x - hx, y + hy, z - hz]]; n = [-1, 0, 0]; break;
        case "pz": v = [[x - hx, y - hy, z + hz], [x + hx, y - hy, z + hz], [x + hx, y + hy, z + hz], [x - hx, y + hy, z + hz]]; n = [0, 0, 1]; break;
        case "nz": v = [[x + hx, y - hy, z - hz], [x - hx, y - hy, z - hz], [x - hx, y + hy, z - hz], [x + hx, y + hy, z - hz]]; n = [0, 0, -1]; break;
        case "py": v = [[x - hx, y + hy, z + hz], [x + hx, y + hy, z + hz], [x + hx, y + hy, z - hz], [x - hx, y + hy, z - hz]]; n = [0, 1, 0]; break;
        default: v = [[x - hx, y - hy, z - hz], [x + hx, y - hy, z - hz], [x + hx, y - hy, z + hz], [x - hx, y - hy, z + hz]]; n = [0, -1, 0]; break;
      }
      for (let k = 0; k < 4; k++) {
        const o = (q * 4 + k) * 3;
        pos[o] = v[k][0]; pos[o + 1] = v[k][1]; pos[o + 2] = v[k][2];
        nor[o] = n[0]; nor[o + 1] = n[1]; nor[o + 2] = n[2];
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
        const horizontal = f === "px" || f === "nx" ? v[k][2] : v[k][0];
        const u2 = (q * 4 + k) * 2;
        uv[u2] = f === "py" || f === "ny" ? v[k][0] / TILE_W : (f === "nx" || f === "pz" ? horizontal : -horizontal) / TILE_W;
        uv[u2 + 1] = f === "py" || f === "ny" ? v[k][2] / TILE_W : v[k][1] / TILE_H;
      }
      const i0 = q * 4;
      idx.set([i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3], q * 6);
      q++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Faces of a grid cell whose 4-neighbour is not in `solid` (the rest are hidden). */
function exposedSides(x: number, z: number, solid: Set<string>): Face[] {
  const out: Face[] = [];
  if (!solid.has(`${x + VOXEL},${z}`)) out.push("px");
  if (!solid.has(`${x - VOXEL},${z}`)) out.push("nx");
  if (!solid.has(`${x},${z + VOXEL}`)) out.push("pz");
  if (!solid.has(`${x},${z - VOXEL}`)) out.push("nz");
  return out;
}

/* ── Textures / materials ─────────────────────────────────────────────── */

/** Pixel-art facade tile: colour map plus an emissive map holding only the lit windows. */
function makeFacade(seed: string, lit: number) {
  const ppu = 12;
  const cols = TILE_W * 2;
  const rows = TILE_H * 1.5;
  const w = TILE_W * ppu;
  const h = TILE_H * ppu;
  const base = document.createElement("canvas");
  const glow = document.createElement("canvas");
  base.width = glow.width = w;
  base.height = glow.height = h;
  const g = base.getContext("2d");
  const e = glow.getContext("2d");
  const pattern = windowPattern(seed, cols, rows, lit);
  if (g && e) {
    g.fillStyle = WALL;
    g.fillRect(0, 0, w, h);
    e.fillStyle = "#000";
    e.fillRect(0, 0, w, h);
    const cw = w / cols;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      g.fillStyle = WALL_DARK;
      g.fillRect(0, Math.floor(r * rh), w, 1);
      for (let cI = 0; cI < cols; cI++) {
        const x = Math.floor(cI * cw + cw * 0.25);
        const y = Math.floor(r * rh + rh * 0.3);
        const ww = Math.max(2, Math.floor(cw * 0.5));
        const wh = Math.max(2, Math.floor(rh * 0.45));
        const on = pattern[r * cols + cI];
        g.fillStyle = on ?? WALL_DARK;
        g.fillRect(x, y, ww, wh);
        if (on) {
          e.fillStyle = on;
          e.fillRect(x, y, ww, wh);
        }
      }
    }
  }
  const finish = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  return { map: finish(base), emissiveMap: finish(glow) };
}

/** Rooftop tile texture: one TILE_W-square of 1-unit tiles with dark grout, multiplied by vertex colour. */
function makeFloorTiles() {
  const ppu = 16;
  const n = TILE_W * ppu;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, n, n);
    g.fillStyle = "#8f88b8";
    for (let i = 0; i < TILE_W; i++) {
      g.fillRect(i * ppu, 0, 1, n);
      g.fillRect(0, i * ppu, n, 1);
    }
    // A brighter bevel on each tile's top-left keeps the grid crisp from the high camera.
    g.fillStyle = "#ffffff";
    for (let i = 0; i < TILE_W; i++) for (let j = 0; j < TILE_W; j++) g.fillRect(i * ppu + 1, j * ppu + 1, ppu - 2, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function useDisposable<T extends { dispose: () => void }>(make: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are forwarded by the caller
  const v = useMemo(make, deps);
  useEffect(() => () => v.dispose(), [v]);
  return v;
}

/* ── Component ────────────────────────────────────────────────────────── */

export function VoxelCity({ area, accentFor, skylineCount, onFloorClick }: { area: Area; accentFor: (zone: Zone) => string; skylineCount: number; onFloorClick: (e: ThreeEvent<MouseEvent>) => void }) {
  // Hub accent can change with the real-world tint, so key the build on it.
  const accentKey = area.zones.map((z) => accentFor(z)).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- accentKey captures accentFor's output
  const vox = useMemo(() => buildVoxelArea(area, accentFor), [area, accentKey]);
  const skyline = useMemo(() => [...buildSkyline(area, skylineCount), ...buildUnderCity(area)], [area, skylineCount]);

  const floorGeo = useDisposable(
    () =>
      mergeBoxes(
        vox.cells.map((c) => ({
          p: [c.x, -0.25, c.z],
          s: [VOXEL, 0.5, VOXEL],
          color: c.corridor ? ROOF_COLORS.corridor : c.walk ? ((Math.floor(c.x) + Math.floor(c.z)) & 1 ? ROOF_COLORS.walkA : ROOF_COLORS.walkB) : ROOF_COLORS.band,
        })),
        ["py"],
      ),
    [vox],
  );

  const { wallGeo, topGeo } = useMemo(() => {
    const roof = new Set(vox.cells.map((c) => `${c.x},${c.z}`));
    const sb = new Set(vox.setback.map((c) => `${c.x},${c.z}`));
    const both = new Set([...roof, ...sb]);
    const walls: GeoBox[] = [];
    const tops: GeoBox[] = [];
    const colH = TOWER_DEPTH;
    for (const c of vox.columns) walls.push({ p: [c.x, -0.5 - colH / 2, c.z], s: [VOXEL, colH, VOXEL], faces: exposedSides(c.x, c.z, roof) });
    const sbH = TOWER_DEPTH + SETBACK_Y;
    for (const c of vox.setback) {
      walls.push({ p: [c.x, SETBACK_Y - sbH / 2, c.z], s: [VOXEL, sbH, VOXEL], faces: exposedSides(c.x, c.z, both) });
      tops.push({ p: [c.x, SETBACK_Y, c.z], s: [VOXEL, 0, VOXEL], faces: ["py"], color: TOP });
    }
    for (const t of skyline) {
      walls.push({ p: [t.x, (t.top + STREET_Y) / 2, t.z], s: [t.w, t.top - STREET_Y, t.d], faces: SIDES });
      tops.push({ p: [t.x, t.top, t.z], s: [t.w, 0, t.d], faces: ["py"], color: TOP });
    }
    return { wallGeo: mergeBoxes(walls), topGeo: mergeBoxes(tops) };
  }, [vox, skyline]);
  useEffect(() => () => wallGeo.dispose(), [wallGeo]);
  useEffect(() => () => topGeo.dispose(), [topGeo]);

  const solidGeo = useDisposable(() => mergeBoxes(vox.solids), [vox]);
  const glowGeo = useDisposable(() => mergeBoxes([...vox.glows, ...skylineGlows(skyline)]), [vox, skyline]);

  const facade = useMemo(() => makeFacade("anima-city", 0.26), []);
  useEffect(() => () => (facade.map.dispose(), facade.emissiveMap.dispose()), [facade]);
  const wallMat = useDisposable(() => new THREE.MeshLambertMaterial({ map: facade.map, emissiveMap: facade.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 1.6 }), [facade]);
  const floorTex = useDisposable(() => makeFloorTiles(), []);
  const floorMat = useDisposable(() => new THREE.MeshLambertMaterial({ map: floorTex, vertexColors: true }), [floorTex]);
  const plainMat = useDisposable(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  const glowMat = useDisposable(() => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), []);

  return (
    <group>
      <mesh geometry={floorGeo} material={floorMat} onClick={onFloorClick} />
      <mesh geometry={wallGeo} material={wallMat} />
      <mesh geometry={topGeo} material={plainMat} />
      <mesh geometry={solidGeo} material={plainMat} />
      <mesh geometry={glowGeo} material={glowMat} />
    </group>
  );
}

/** Rooftop caps, antenna tips and vertical neon signs on skyline towers. */
export function skylineGlows(towers: readonly SkylineTower[]): VoxelBox[] {
  const out: VoxelBox[] = [];
  for (const t of towers) {
    if (t.cap) {
      out.push({ p: [t.x, t.top + 0.08, t.z], s: [t.w * 0.96, 0.16, t.d * 0.96], color: t.cap });
      out.push({ p: [t.x, t.top + 1.6, t.z], s: [0.18, 3, 0.18], color: t.cap });
    }
    if (t.sign) {
      // Vertical sign hung on the tower face that looks back at the area.
      const fx = Math.abs(t.x) > Math.abs(t.z);
      const sx = fx ? -Math.sign(t.x) * (t.w / 2 + 0.08) : 0;
      const sz = fx ? 0 : -Math.sign(t.z) * (t.d / 2 + 0.08);
      out.push({ p: [t.x + sx, t.top - 4, t.z + sz], s: [fx ? 0.12 : 0.8, 5, fx ? 0.8 : 0.12], color: t.sign });
    }
  }
  return out;
}
