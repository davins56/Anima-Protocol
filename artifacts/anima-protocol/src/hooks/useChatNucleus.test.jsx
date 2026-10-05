import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useChatNucleus } from "@/hooks/useChatNucleus";
import { animaApi } from "@/api/animaApi";

vi.mock("@/api/animaApi", () => ({
  animaApi: {
    chat: {
      sendMessage: vi.fn(),
    },
  },
}));

// Minimal renderHook-equivalent (no @testing-library/react in this repo — see
// ErrorBoundary.test.jsx etc. for the same createRoot/act convention): a host
// component calls the hook every render and stashes its latest return value
// on `result.current`, mirroring what @testing-library/react's renderHook
// exposes.
function renderHook(useHookFn) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: undefined };

  function Host() {
    result.current = useHookFn();
    return null;
  }

  act(() => {
    root.render(<Host />);
  });

  return {
    result,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useChatNucleus", () => {
  it("appends messages and handles an empty provider response gracefully", async () => {
    animaApi.chat.sendMessage.mockImplementation(async function* () {
      yield { content: "Hello" };
      yield { done: true };
    });

    const { result, unmount } = renderHook(() =>
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
    unmount();
  });

  it("records an error message when the provider fails", async () => {
    animaApi.chat.sendMessage.mockImplementation(async function* () {
      throw new Error("Provider failed");
    });

    const { result, unmount } = renderHook(() =>
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
    unmount();
  });
  it.each([
    ["terminal-only reply", [{ done: true, visible: "I heard your question." }]],
    ["partial stream", [{ content: "I heard" }, { done: true, visible: "I heard your question." }]],
    ["terminal content snapshot", [{ content: "I heard" }, { done: true, content: "I heard your question." }]],
  ])("renders the authoritative %s exactly once", async (_label, events) => {
    animaApi.chat.sendMessage.mockImplementation(async function* () {
      for (const event of events) yield event;
    });
    const { result, unmount } = renderHook(() =>
      useChatNucleus({ sessionId: "test-session", activeCharacter: { id: "c1", name: "Astra" } }),
    );
    try {
      await act(async () => {
        await result.current.sendMessage({ text: "Did you hear my question?" });
      });
      expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
        { role: "user", content: "Did you hear my question?" },
        { role: "assistant", content: "I heard your question." },
      ]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    } finally {
      unmount();
    }
  });

});
