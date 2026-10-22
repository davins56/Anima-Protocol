/**
 * Event → transient visual effect. sim-core resolves hits instantly on the
 * tick they happen; these descriptors give them a short, interpolated life on
 * screen (tracer, impact burst, flinch, terrain flash, corruption glitch…).
 */
import { BAND_BY_KEY, layerAt, type BandKey, type Cell, type EmittedEvent, type PanelKind, type SimState } from "@workspace/sim-core";

export type Fx =
  | { id: string; kind: "shot"; tick: number; life: number; from: Cell; to: Cell; color: string; sourceId: string }
  | { id: string; kind: "impact"; tick: number; life: number; cell: Cell; color: string; amount: number }
  | { id: string; kind: "panel"; tick: number; life: number; cell: Cell; to: PanelKind }
  | { id: string; kind: "corrupt"; tick: number; life: number; targetEventId: string; severity: number; band: BandKey }
  | { id: string; kind: "restore"; tick: number; life: number; targetEventId: string }
  | { id: string; kind: "purify"; tick: number; life: number; unitId: string }
  | { id: string; kind: "defeat"; tick: number; life: number; unitId: string; cell: Cell; color: string }
  | { id: string; kind: "drain"; tick: number; life: number; amount: number; reason: string }
  | { id: string; kind: "reject"; tick: number; life: number; reason: string };

export const FLINCH_TICKS = 6;

export function deriveFx(events: EmittedEvent[], s: SimState): Fx[] {
  const out: Fx[] = [];
  for (const e of events) {
    const id = `${e.seq}`;
    switch (e.type) {
      case "hit": {
        const src = s.units.find((u) => u.id === e.sourceId);
        const color = BAND_BY_KEY[e.band].color;
        if (src) {
          const from = { layer: layerAt(src.w), col: src.col, row: src.row };
          out.push({ id: `${id}-s`, kind: "shot", tick: e.tick, life: 3, from, to: e.cell, color, sourceId: src.id });
        }
        out.push({ id: `${id}-i`, kind: "impact", tick: e.tick + (src ? 2 : 0), life: 6, cell: e.cell, color, amount: e.amount });
        break;
      }
      case "panel_changed":
        out.push({ id, kind: "panel", tick: e.tick, life: 6, cell: e.cell, to: e.to });
        break;
      case "memory_corrupted":
        out.push({ id, kind: "corrupt", tick: e.tick, life: 18, targetEventId: e.targetEventId, severity: e.severity, band: e.band });
        break;
      case "memory_restored":
        out.push({ id, kind: "restore", tick: e.tick, life: 24, targetEventId: e.targetEventId });
        break;
      case "chip_used":
        if (e.chip === "purify") out.push({ id, kind: "purify", tick: e.tick, life: 20, unitId: e.unitId });
        break;
      case "unit_defeated": {
        const u = s.units.find((x) => x.id === e.unitId);
        if (u) out.push({ id, kind: "defeat", tick: e.tick, life: 14, unitId: u.id, cell: { layer: layerAt(u.w), col: u.col, row: u.row }, color: BAND_BY_KEY[u.band].color });
        break;
      }
      case "memory_drain":
        out.push({ id, kind: "drain", tick: e.tick, life: 10, amount: e.amount, reason: e.reason });
        break;
      case "rejected":
        out.push({ id, kind: "reject", tick: e.tick, life: 30, reason: e.reason });
        break;
    }
  }
  return out;
}

/** unitId → tick until which it flinches (from damage events). */
export function flinchUpdates(events: EmittedEvent[]): Array<[string, number]> {
  return events.filter((e): e is Extract<EmittedEvent, { type: "damage" }> => e.type === "damage").map((e) => [e.targetId, e.tick + FLINCH_TICKS]);
}

export function pruneFx(list: Fx[], tick: number): Fx[] {
  return list.filter((f) => tick < f.tick + f.life);
}
