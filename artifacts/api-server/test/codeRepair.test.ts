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
        openrouterModel: "minimax/minimax-m2.7:free",
        openrouterIsFreeTier: true,
      },
    });

    expect(analysis.category).toBe("openrouter_quota");
    expect(analysis.confidence).toBe("high");
    expect(analysis.canAutoApply).toBe(false);
    expect(analysis.repairSteps.map((step) => step.title)).toContain(
      "Point chat at the custom Anima LLM",
    );
    expect(analysis.likelyCause).toMatch(/ANIMA_LOCAL_LLM_BASE_URL is unset/i);
    expect(analysis.likelyCause).toMatch(/already on :free models/i);
    expect(analysis.likelyCause).not.toMatch(/Setting ANIMA_OPENROUTER_FREE=true cannot bypass/i);
    expect(analysis.guardrails.join(" ")).toMatch(/does not mutate/i);
  });

  it("tells the operator not to keep skipping a configured custom LLM", () => {
    const analysis = analyzeCodeRepairInput({
      issue: "OpenRouter credits/rate limit exhausted: HTTP 429 free-models-per-day",
      diagnostics: {
        openrouterConfigured: true,
        localConfigured: true,
        localHost: "anima-chat-llm.fly.dev",
        customOnly: false,
      },
    });

    expect(analysis.category).toBe("openrouter_quota");
    expect(analysis.likelyCause).toMatch(/custom LLM host/i);
    expect(analysis.repairSteps[0]?.title).toMatch(/custom Anima LLM/i);
  });

  it("keeps generic issues bounded and non-mutating", () => {
    const analysis = analyzeCodeRepairInput({ issue: "The page looks wrong after I click save." });

    expect(analysis.category).toBe("generic");
    expect(analysis.canAutoApply).toBe(false);
    expect(analysis.repairSteps.length).toBeGreaterThan(0);
  });
});
