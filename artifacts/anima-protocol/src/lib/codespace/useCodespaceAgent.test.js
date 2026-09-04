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
    const payload = invokeMock.mock.calls[0][0];
    expect(payload.messages[0]).toEqual({ role: "user", content: "build a neon clock" });
    expect(payload.files).toEqual(["index.html"]);
    expect(payload.character).toEqual(expect.objectContaining({
      name: "Serenity",
      personality: "Warm and precise",
      speaking_style: "Soft, poetic",
      is_anima: true,
      soulprint: expect.stringContaining("AR-1"),
    }));
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

    const payload = invokeMock.mock.calls[0][0];
    expect(payload.messages[0]).toEqual({ role: "user", content: "debug app.js" });
    expect(payload.files).toEqual(["app.js"]);
    expect(payload.character).toEqual(JULES_PERSONA);
    expect(payload.character.id).toBe("jules-ai-engineer");
    expect(payload.character.is_anima).toBeUndefined();
  });
});
