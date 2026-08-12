import { describe, expect, it } from "vitest";
import { analyzeCodeRepairInput } from "../src/lib/codeRepair";

describe("analyzeCodeRepairInput", () => {
  it("identifies OpenRouter free-model daily caps and returns a safe repair plan", () => {
    const analysis = analyzeCodeRepairInput({
      issue:
        "OpenRouter credits/rate limit exhausted: HTTP 429 - 429 Rate limit exceeded: free-models-per-day. Add 10 credits.",
      diagnostics: {
        openrouterConfigured: true,
        openrouterEnv: "OPENROUTER_API_KEY",
        openrouterModel: "openai/gpt-oss-20b:free",
        openrouterIsFreeTier: true,
      },
    });

    expect(analysis.category).toBe("openrouter_quota");
    expect(analysis.confidence).toBe("high");
    expect(analysis.canAutoApply).toBe(false);
    expect(analysis.repairSteps.map((step) => step.title)).toContain("Resolve the provider quota");
    expect(analysis.guardrails.join(" ")).toMatch(/does not mutate/i);
  });

  it("keeps generic issues bounded and non-mutating", () => {
    const analysis = analyzeCodeRepairInput({ issue: "The page looks wrong after I click save." });

    expect(analysis.category).toBe("generic");
    expect(analysis.canAutoApply).toBe(false);
    expect(analysis.repairSteps.length).toBeGreaterThan(0);
  });
});
