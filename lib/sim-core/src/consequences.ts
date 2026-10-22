/**
 * Reducers: how each event changes state. Pure and order-independent per event;
 * the bus (engine.ts) applies an event *before* running rules on it, so rules
 * always see the post-event state.
 */
import { clampW, layerAt } from "./bands";
import { COLS, ROWS, type Cell, type SimEvent, type SimState, type Unit } from "./types";

export function unitById(s: SimState, id: string): Unit | undefined {
  return s.units.find((u) => u.id === id);
}

export function panelAt(s: SimState, c: Cell) {
  return s.panels[c.layer]?.[c.row]?.[c.col];
}

export function unitCell(u: Unit): Cell {
  return { layer: layerAt(u.w), col: u.col, row: u.row };
}

export function alive(u: Unit): boolean {
  return u.hp > 0;
}

/** Units that can be hit at a cell: alive, not mid phase-shift, on that layer. */
export function unitsAt(s: SimState, c: Cell): Unit[] {
  return s.units.filter((u) => alive(u) && !u.phase && layerAt(u.w) === c.layer && u.col === c.col && u.row === c.row);
}

function nearestStandable(s: SimState, u: Unit, layer: number): { col: number; row: number } {
  const minC = u.side === "player" ? 0 : 3;
  const maxC = u.side === "player" ? 2 : COLS - 1;
  let best = { col: u.col, row: u.row, d: Infinity };
  for (let r = 0; r < ROWS; r++)
    for (let c = minC; c <= maxC; c++) {
      if (s.panels[layer][r][c].kind === "broken") continue;
      const d = Math.abs(c - u.col) + Math.abs(r - u.row);
      if (d < best.d) best = { col: c, row: r, d };
    }
  return { col: best.col, row: best.row };
}

export function applyEvent(s: SimState, e: SimEvent): void {
  switch (e.type) {
    case "damage": {
      const u = unitById(s, e.targetId);
      if (u) u.hp = Math.max(0, Math.round(u.hp - e.amount));
      return;
    }
    case "panel_changed": {
      const p = panelAt(s, e.cell);
      if (p) {
        p.kind = e.to;
        p.until = e.until;
      }
      return;
    }
    case "unit_entered_panel": {
      const u = unitById(s, e.unitId);
      if (u) {
        u.col = e.cell.col;
        u.row = e.cell.row;
      }
      return;
    }
    case "memory_drain":
      s.memory = Math.max(0, s.memory - e.amount);
      return;
    case "memory_gain":
      s.memory = Math.min(100, s.memory + e.amount);
      return;
    case "portal_opened":
      s.portals.push(e.portal);
      return;
    case "portal_closed":
      s.portals = s.portals.filter((p) => p.id !== e.portalId);
      return;
    case "phase_started": {
      const u = unitById(s, e.unitId);
      if (u) u.phase = e.shift;
      return;
    }
    case "phase_landed": {
      const u = unitById(s, e.unitId);
      if (!u) return;
      u.w = clampW(e.w);
      u.phase = null;
      if (s.panels[e.layer][u.row][u.col].kind === "broken") Object.assign(u, nearestStandable(s, u, e.layer));
      return;
    }
    case "telegraph": {
      const u = unitById(s, e.unitId);
      if (u) u.telegraph = e.telegraph;
      return;
    }
    case "memory_corrupted":
      s.corruptions.push({ targetEventId: e.targetEventId, tick: s.tick, severity: e.severity, band: e.band, restored: false });
      s.lastCorruptionTick = s.tick;
      return;
    case "memory_restored": {
      const c = s.corruptions.find((x) => x.targetEventId === e.targetEventId && !x.restored);
      if (c) c.restored = true;
      return;
    }
    case "battle_end":
      if (!s.outcome) s.outcome = e.outcome;
      return;
    default:
      return;
  }
}
