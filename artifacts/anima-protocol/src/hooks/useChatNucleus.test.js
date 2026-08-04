import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatNucleus } from "@/hooks/useChatNucleus";
import { animaApi } from "@/api/animaApi";

vi.mock("@/api/animaApi", () => ({
  animaApi: {
    chat: {
      sendMessage: vi.fn(),
    },
  },
}));

describe("useChatNucleus", () => {
  it("appends messages and handles an empty provider response gracefully", async () => {
    animaApi.chat.sendMessage.mockImplementation(async function* () {
      yield { content: "Hello" };
      yield { done: true };
    });

    const { result } = renderHook(() =>
      useChatNucleus({
        sessionId: "test-session",
        initialMessages: [],
        characters: [{ id: "c1", name: "Astra" }],
        activeCharacter: { id: "c1", name: "Astra" },
        mode: "solo",
      }),
    );

    await act(async () => {
      await result.current.sendMessage({ text: "Hello" });
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(result.current.error).toBeNull();
  });

  it("records an error message when the provider fails", async () => {
    animaApi.chat.sendMessage.mockImplementation(async function* () {
      throw new Error("Provider failed");
    });

    const { result } = renderHook(() =>
      useChatNucleus({
        sessionId: "test-session",
        initialMessages: [],
        characters: [{ id: "c1", name: "Astra" }],
        activeCharacter: { id: "c1", name: "Astra" },
        mode: "solo",
      }),
    );

    await act(async () => {
      await result.current.sendMessage({ text: "Hello" });
    });

    expect(result.current.messages.some((msg) => msg.role === "assistant" && msg.content.includes("System:"))).toBe(true);
    expect(result.current.error).toBe("Provider failed");
  });
});
