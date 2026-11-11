/**
 * Normalise a model's predicted what-if branches into the shape the UI reads.
 *
 * `WhatIfBranchExplorer` and `WhatIfTimeline` both read `decision_point` and
 * `divergence_point` (the model is asked for one or the other), and a branch
 * with neither is useless on screen. Keeping the two in sync here rather than
 * in three components means the screens cannot disagree about a branch.
 *
 * Kept free of DB and model imports so it can be unit-tested directly.
 */
export function normalizePredictedBranches(
  raw: unknown,
  limit = 3,
): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter(
      (b): b is Record<string, unknown> => Boolean(b) && typeof b === "object",
    )
    .slice(0, Math.max(1, limit))
    .map((b, i) => {
      const decision = String(b.decision_point ?? b.divergence_point ?? "").trim();
      const probability = Number(b.divergence_probability);
      return {
        branch_id: String(b.branch_id ?? `branch-${i + 1}`),
        branch_name: String(b.branch_name ?? `Branch ${i + 1}`).trim(),
        decision_point: decision,
        divergence_point: decision,
        outcome_summary: String(b.outcome_summary ?? "").trim(),
        divergence_probability: Number.isFinite(probability)
          ? Math.min(Math.max(probability, 0), 1)
          : null,
        prompt: String(b.prompt ?? "").trim(),
      };
    });
}
