import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizePredictedBranches } from "../src/lib/whatIfBranches";

describe("normalizePredictedBranches", () => {
  it("keeps decision_point and divergence_point in sync", () => {
    const [branch] = normalizePredictedBranches([
      { branch_name: "Peace", divergence_point: "She spares him" },
    ]);

    expect(branch.branch_name).toBe("Peace");
    expect(branch.decision_point).toBe("She spares him");
    // WhatIfBranchExplorer reads divergence_point, the timeline reads
    // decision_point — one value, two names, never disagreeing.
    expect(branch.divergence_point).toBe(branch.decision_point);
  });

  it("clamps probability and drops junk entries", () => {
    const out = normalizePredictedBranches(
      [{ divergence_probability: 40 }, null, "nope", { branch_name: "B" }],
      3,
    );

    expect(out).toHaveLength(2);
    expect(out[0].divergence_probability).toBe(1);
    expect(out[1].divergence_probability).toBeNull();
  });

  it("honours the limit and survives a non-array response", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ branch_name: `b${i}` }));
    expect(normalizePredictedBranches(many, 3)).toHaveLength(3);
    expect(normalizePredictedBranches("not json")).toEqual([]);
  });

  it("registers all three what-if RPCs on the invoke handler", () => {
    // These three were the only what-if calls falling through to the generic
    // handler, which returned a prose string where the screens expect JSON.
    const src = readFileSync(
      fileURLToPath(new URL("../src/routes/openai/functions.ts", import.meta.url)),
      "utf8",
    );
    expect(src).toContain('case "predictNarrativeBranches"');
    expect(src).toContain('case "createWorldBranch"');
    expect(src).toContain('case "restoreWorldBranch"');
  });
});
