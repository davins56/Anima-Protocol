import { describe, it, expect, vi } from "vitest";
import {
  JULES_PERSONA,
  createJulesTask,
  executeAgentStep,
  debugAndTroubleshoot,
  julesApi,
} from "./julesApi";

vi.mock("@/api/base44Client", () => ({
  base44: {
    functions: {
      codespaceAgentStep: {
        invoke: vi.fn(),
      },
    },
    integrations: {
      Core: {
        InvokeLLM: vi.fn(),
      },
    },
  },
}));

import { base44 } from "@/api/base44Client";

describe("julesApi", () => {
  it("exports JULES_PERSONA correctly", () => {
    expect(JULES_PERSONA.id).toBe("jules-ai-engineer");
    expect(JULES_PERSONA.name).toBe("Jules (AI Engineer)");
    expect(julesApi.JULES_PERSONA).toEqual(JULES_PERSONA);
  });

  it("createJulesTask initializes task object", () => {
    const task = createJulesTask("Fix main.js syntax error", [{ path: "main.js", content: "console.log(1);" }]);
    expect(task.id).toMatch(/^jules-task-/);
    expect(task.goal).toBe("Fix main.js syntax error");
    expect(task.files).toHaveLength(1);
    expect(task.mode).toBe("debug");
    expect(task.status).toBe("pending");
  });

  it("executeAgentStep delegates to base44.functions.codespaceAgentStep", async () => {
    vi.mocked(base44.functions.codespaceAgentStep.invoke).mockResolvedValueOnce({
      message: {
        role: "assistant",
        content: "Analyzed code and fixed issue.",
        tool_calls: [],
      },
    });

    const msg = await executeAgentStep(
      [{ role: "user", content: "Debug this app" }],
      [{ path: "app.js" }]
    );

    expect(base44.functions.codespaceAgentStep.invoke).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "Debug this app" }],
      character: JULES_PERSONA,
      files: ["app.js"],
    });
    expect(msg.content).toBe("Analyzed code and fixed issue.");
  });

  it("executeAgentStep falls back to InvokeLLM if codespaceAgentStep returns empty", async () => {
    vi.mocked(base44.functions.codespaceAgentStep.invoke).mockResolvedValueOnce(null);
    vi.mocked(base44.integrations.Core.InvokeLLM).mockResolvedValueOnce({
      content: "Jules fallback repair analysis.",
      tool_calls: [],
    });

    const msg = await executeAgentStep(
      [{ role: "user", content: "Help me debug" }],
      ["index.html"]
    );

    expect(base44.integrations.Core.InvokeLLM).toHaveBeenCalled();
    expect(msg.content).toBe("Jules fallback repair analysis.");
  });

  it("debugAndTroubleshoot identifies clean runs", async () => {
    const files = [{ path: "main.js", content: "const a = 1; console.log(a);" }];
    const lastRun = { path: "main.js", mode: "js", ok: true, errors: [] };

    const result = await debugAndTroubleshoot({ files, lastRun });
    expect(result.ok).toBe(true);
    expect(result.securityThreats).toHaveLength(0);
    expect(result.runErrors).toHaveLength(0);
    expect(result.summary).toContain("no syntax or runtime errors detected");
  });

  it("debugAndTroubleshoot flags security threats and runtime errors", async () => {
    const files = [
      { path: "app.js", content: "eval('window.secret = 123');" }, // eval flagged as threat
    ];
    const lastRun = {
      path: "app.js",
      mode: "js",
      ok: false,
      errors: ["Uncaught ReferenceError: foo is not defined"],
    };

    const result = await debugAndTroubleshoot({ files, lastRun });
    expect(result.ok).toBe(false);
    expect(result.securityThreats.length).toBeGreaterThan(0);
    expect(result.runErrors).toEqual(["Uncaught ReferenceError: foo is not defined"]);
    expect(result.combinedErrors.length).toBeGreaterThan(1);
    expect(result.repairGoal).toContain("Debug and repair it");
    expect(result.summary).toContain("Jules detected");
  });
});
