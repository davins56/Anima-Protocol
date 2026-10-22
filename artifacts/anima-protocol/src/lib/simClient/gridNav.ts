/**
 * Grid collision helpers. sim-core is authoritative (it rejects moves onto
 * broken panels / off the player half and relocates units that land on a
 * broken panel); these mirror its rules so taps can be turned into legal move
 * sequences and the UI can preview reachability. No rigid bodies: every unit
 * occupies exactly one panel.
 */
import { COLS, PLAYER_MAX_COL, ROWS, layerAt, type SimAction, type SimState, type Side, type Unit } from "@workspace/sim-core";

export type GridCell = { col: number; row: number };

export function sideRange(side: Side): [number, number] {
  return side === "player" ? [0, PLAYER_MAX_COL] : [PLAYER_MAX_COL + 1, COLS - 1];
}

export function standable(s: SimState, layer: number, col: number, row: number, side: Side = "player"): boolean {
  const [lo, hi] = sideRange(side);
  if (col < lo || col > hi || row < 0 || row >= ROWS) return false;
  return s.panels[layer]?.[row]?.[col]?.kind !== "broken";
}

/** Living, non-phasing units standing on a cell (what a hit there would strike). */
export function occupants(s: SimState, layer: number, col: number, row: number): Unit[] {
  return s.units.filter((u) => u.hp > 0 && !u.phase && layerAt(u.w) === layer && u.col === col && u.row === row);
}

/** Shortest 4-neighbour path over standable panels, as unit move actions. */
export function pathTo(s: SimState, layer: number, from: GridCell, to: GridCell, side: Side = "player"): SimAction[] | null {
  if (from.col === to.col && from.row === to.row) return [];
  if (!standable(s, layer, to.col, to.row, side)) return null;
  const key = (c: GridCell) => c.row * COLS + c.col;
  const prev = new Map<number, GridCell | null>([[key(from), null]]);
  const queue: GridCell[] = [from];
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.col === to.col && cur.row === to.row) break;
    for (const [dc, dr] of dirs) {
      const n = { col: cur.col + dc, row: cur.row + dr };
      if (prev.has(key(n)) || !standable(s, layer, n.col, n.row, side)) continue;
      prev.set(key(n), cur);
      queue.push(n);
    }
  }
  if (!prev.has(key(to))) return null;
  const steps: SimAction[] = [];
  for (let c: GridCell = to; ; ) {
    const p = prev.get(key(c));
    if (!p) break;
    steps.unshift({ t: "move", dc: c.col - p.col, dr: c.row - p.row });
    c = p;
  }
  return steps;
}

/**
 * A tap on a panel of the navi's layer: player-half → walk there; enemy-half →
 * line up on that row and fire the buster.
 */
export function actionsForPanelTap(s: SimState, layer: number, col: number, row: number): SimAction[] {
  const navi = s.units[0];
  if (!navi || navi.phase || layerAt(navi.w) !== layer) return [];
  const from = { col: navi.col, row: navi.row };
  if (col <= PLAYER_MAX_COL) return pathTo(s, layer, from, { col, row }) ?? [];
  const path = pathTo(s, layer, from, { col: navi.col, row }) ?? (row === navi.row ? [] : null);
  return path ? [...path, { t: "buster" }] : [];
}
