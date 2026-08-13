import { COLS, ROWS } from "./netBattle";

export const PANEL_SIZE = 1.08;
export const PANEL_GAP = 0.14;
export const CELL = PANEL_SIZE + PANEL_GAP;
export const PANEL_THICKNESS = 0.08;

export function panelWorldPosition(col, row, y = 0) {
  const x = (Number(col) - (COLS - 1) / 2) * CELL;
  const z = (Number(row) - (ROWS - 1) / 2) * CELL;
  return [x, y, z];
}

export function figureWorldPosition(col, row) {
  return panelWorldPosition(col, row, PANEL_THICKNESS);
}
