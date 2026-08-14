import { describe, expect, it } from "vitest";
import { CELL, figureWorldPosition, panelWorldPosition } from "./battleLayout";
import { COLS } from "./netBattle";

describe("battleLayout", () => {
  it("places column 0 left of column 5", () => {
    const [x0] = panelWorldPosition(0, 1);
    const [x5] = panelWorldPosition(5, 1);
    expect(x0).toBeLessThan(x5);
    expect(x5 - x0).toBeCloseTo((COLS - 1) * CELL);
  });

  it("stands figures on top of the panel", () => {
    const [, y] = figureWorldPosition(1, 1);
    expect(y).toBeGreaterThan(0);
  });
});
