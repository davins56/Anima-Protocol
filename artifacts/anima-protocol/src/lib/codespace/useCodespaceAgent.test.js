import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JULES_PERSONA } from "./julesApi";

const invokeMock = vi.fn();

vi.mock("@/api/base44Client", () => ({
  base44: {
    functions: {
      codespaceAgentStep: {
        invoke: (...args) => invokeMock(...args),
      },
    },
    integrations: {
      Core: { InvokeLLM: vi.fn() },
    },
  },
}));

import { useCodespaceAgent } from "./useCodespaceAgent";

describe("useCodespaceAgent character payload", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      message: { role: "assistant", content: "Done.", tool_calls: [] },
    });
  });

  it("sends Anima personality on codespaceAgentStep", async () => {
    const anima = {
      id: "anima-1",
      name: "Serenity",
      personality: "Warm and precise",
      speaking_style: "Soft, poetic",
      _isAnima: true,
      _companionKind: "anima",
      soulprint: { id: "AR-1", core_drive: "Protection" },
    };
    const { result } = renderHook(() =>
      useCodespaceAgent({
        character: anima,
        executeTool: vi.fn(),
        getFiles: () => [{ path: "index.html" }],
      }),
    );

    await act(async () => {
      await result.current.runGoal("build a neon clock");
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "build a neon clock" }],
      character: expect.objectContaining({
        name: "Serenity",
        personality: "Warm and precise",
        speaking_style: "Soft, poetic",
        is_anima: true,
        soulprint: expect.stringContaining("AR-1"),
      }),
      files: ["index.html"],
    });
  });

  it("keeps the Jules path when Jules is selected", async () => {
    const { result } = renderHook(() =>
      useCodespaceAgent({
        character: JULES_PERSONA,
        executeTool: vi.fn(),
        getFiles: () => [{ path: "app.js" }],
      }),
    );

    await act(async () => {
      await result.current.runGoal("debug app.js");
    });

    expect(invokeMock).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "debug app.js" }],
      character: JULES_PERSONA,
      files: ["app.js"],
    });
    const payload = invokeMock.mock.calls[0][0].character;
    expect(payload.id).toBe("jules-ai-engineer");
    expect(payload.is_anima).toBeUndefined();
  });
});
