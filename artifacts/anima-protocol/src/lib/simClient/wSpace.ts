/**
 * The 4th axis made visible. Each frequency layer is a full 6×3 arena placed
 * along a "W direction" in world space (receding in depth and rising), tinted
 * by its band. Units stand on their layer's plane; during a phase-shift they
 * (and the camera) slide along W between planes while dissolving.
 *
 * Interpolation: render time is prev.tick + alpha, so positions are lerped
 * between the two most recent sim states and phase progress is continuous.
 */
import { BAND_BY_KEY, BANDS, clampW, LAYER_W, layerAt, type SimState, type Unit } from "@workspace/sim-core";

/** World-space offset per unit of W (depth into the screen + slight rise). */
export const W_WORLD = { y: 0.075, z: -0.3 } as const;

export function wOffset(w: number): [number, number, number] {
  const c = clampW(w);
  return [0, c * W_WORLD.y, c * W_WORLD.z];
}

/** W of the arena plane a unit at `w` stands on. */
export function planeW(w: number): number {
  return LAYER_W[layerAt(w)];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 0→1 progress of a unit's current phase-shift at fractional tick t (null if not shifting). */
export function phaseProgress(u: Unit | undefined, t: number): number | null {
  if (!u?.phase) return null;
  const span = Math.max(1, u.phase.landTick - u.phase.startTick);
  return clamp01((t - u.phase.startTick) / span);
}

/** Plane-W of a unit at fractional tick t: snaps to its layer, slides during a shift. */
export function unitPlaneWAt(u: Unit, t: number): number {
  const p = phaseProgress(u, t);
  if (p === null || !u.phase) return planeW(u.w);
  return planeW(u.phase.fromW) + (planeW(u.phase.toW) - planeW(u.phase.fromW)) * smoothstep(p);
}

/** Exact signal W at fractional tick t (drives clarity/colour; continuous during shifts). */
export function unitSignalWAt(u: Unit, t: number): number {
  const p = phaseProgress(u, t);
  if (p === null || !u.phase) return u.w;
  return u.phase.fromW + (u.phase.toW - u.phase.fromW) * p;
}

/**
 * Dissolve amount for a shift: dissolve out over the first half at the source
 * layer, fully dematerialised at the midpoint (when the engine makes the unit
 * untargetable), re-materialise at the target over the second half.
 */
export function dissolveFor(progress: number | null): number {
  if (progress === null) return 0;
  return progress < 0.5 ? smoothstep(progress / 0.5) : smoothstep((1 - progress) / 0.5);
}

export type UnitPose = {
  id: string;
  col: number;
  row: number;
  /** plane W for placement */
  planeW: number;
  /** exact signal W */
  w: number;
  progress: number | null;
  dissolve: number;
};

export function unitPose(prev: SimState, curr: SimState, alpha: number, id: string): UnitPose | null {
  const b = curr.units.find((u) => u.id === id);
  if (!b) return null;
  const a = prev.units.find((u) => u.id === id) ?? b;
  const t = prev.tick + (curr.tick - prev.tick) * alpha;
  const k = clamp01(alpha);
  // A shift may start or land between prev and curr; evaluate both at their own tick and lerp.
  const pw = unitPlaneWAt(a, prev.tick) + (unitPlaneWAt(b, curr.tick) - unitPlaneWAt(a, prev.tick)) * k;
  const sw = unitSignalWAt(a, prev.tick) + (unitSignalWAt(b, curr.tick) - unitSignalWAt(a, prev.tick)) * k;
  const progress = phaseProgress(b.phase ? b : a.phase ? a : undefined, t);
  return {
    id,
    col: a.col + (b.col - a.col) * k,
    row: a.row + (b.row - a.row) * k,
    planeW: pw,
    w: sw,
    progress,
    dissolve: dissolveFor(progress),
  };
}

/** Band colour for a unit's native band. */
export function bandColor(key: keyof typeof BAND_BY_KEY): string {
  return BAND_BY_KEY[key].color;
}

/** Tesseract XW rotation for a W (one full turn across the spectrum). */
export function wRotation(w: number): number {
  return (clampW(w) / 100) * Math.PI * 2;
}

export const LAYER_COLORS = BANDS.map((b) => b.color);
