/**
 * Frequency (W axis) input mapping: the continuous dial / device tilt produce a
 * W the player is *aiming* for; these helpers turn that into a legal sim-core
 * phase-shift target (±MAX_PHASE_DW per shift, 0.1 resolution).
 */
import { bandAt, clampW, LAYER_COUNT, LAYER_W, layerAt, MAX_PHASE_DW, type BandSpec } from "@workspace/sim-core";

/** Shifts smaller than this are rejected by the engine ("already there"). */
export const PHASE_DEADZONE = 0.5;
/** Dial must rest this long before a shift is committed (avoids a shift per pixel). */
export const DIAL_SETTLE_MS = 350;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Band lookup on the W axis (same bands as design tokens / sim-core). */
export function bandForW(w: number): BandSpec {
  return bandAt(w);
}

/**
 * Map an aimed dial value to a phase target reachable in one shift from
 * `currentW`. Returns null when the aim is inside the dead zone.
 */
export function dialToPhaseTarget(dialW: number, currentW: number): number | null {
  const aim = clampW(dialW);
  const dw = Math.max(-MAX_PHASE_DW, Math.min(MAX_PHASE_DW, aim - currentW));
  if (Math.abs(dw) < PHASE_DEADZONE) return null;
  return round1(clampW(currentW + dw));
}

/** Q/E, bumpers: hop to the centre of the neighbouring layer (always within ±45). */
export function phaseStepTarget(currentW: number, dir: 1 | -1): number | null {
  const layer = layerAt(currentW) + dir;
  if (layer < 0 || layer >= LAYER_COUNT) return null;
  return dialToPhaseTarget(LAYER_W[layer], currentW);
}

/** Phase target for "go to that layer" (resonance node tap, ghost-arena tap). */
export function layerPhaseTarget(layer: number, currentW: number): number | null {
  if (layer < 0 || layer >= LAYER_COUNT) return null;
  return dialToPhaseTarget(LAYER_W[layer], currentW);
}

/**
 * Device tilt → dial. gamma (left/right tilt, degrees) of ±rangeDeg spans
 * ±50 W around the W the player had when tilt was enabled.
 */
export function tiltToW(gammaDeg: number, baseW: number, rangeDeg = 35): number {
  const g = Math.max(-rangeDeg, Math.min(rangeDeg, Number.isFinite(gammaDeg) ? gammaDeg : 0));
  return round1(clampW(baseW + (g / rangeDeg) * 50));
}

/** Should a settled dial value be turned into a phase action now? */
export function shouldCommitDial(args: {
  dialW: number;
  currentW: number;
  lastMoveAt: number;
  now: number;
  busy: boolean;
  settleMs?: number;
}): number | null {
  if (args.busy) return null;
  if (args.now - args.lastMoveAt < (args.settleMs ?? DIAL_SETTLE_MS)) return null;
  return dialToPhaseTarget(args.dialW, args.currentW);
}
