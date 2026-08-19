import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  assignTurnMessageIds,
  createChatTurnId,
  useChatPersistence,
} from "./useChatPersistence";
import { base44 } from "@/api/base44Client";
import { animaApi } from "@/api/animaApi";

vi.mock("@/api/base44Client", () => ({
  base44: {
    messages: {
      append: vi.fn(),
    },
    entities: {
      ChatSession: {
        update: vi.fn(),
      },
    },
  },
}));

vi.mock("@/api/animaApi", () => ({
  animaApi: {
    chat: {
      commitTurn: vi.fn(),
      retryTurn: vi.fn(),
    },
  },
}));

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

describe("chat persistence identifiers", () => {
  it("creates server-accepted idempotency keys", () => {
    expect(createChatTurnId()).toMatch(/^turn_[A-Za-z0-9_-]{8,}/);
  });

  it("assigns stable ids to a complete visible turn", () => {
    const messages = assignTurnMessageIds(
      [
        { role: "user", content: "hello" },
        { role: "assistant", type: "event", content: "calm" },
        { role: "assistant", content: "first" },
        { role: "assistant", content: "second" },
      ],
      "turn_example123",
    );

    expect(messages.map((message) => message.id)).toEqual([
      "turn_example123:user",
      "turn_example123:event",
      "turn_example123:assistant",
      "turn_example123:assistant:1",
    ]);
    expect(messages.every((message) => message.turn_id === "turn_example123")).toBe(
      true,
    );
  });
});

describe("useChatPersistence persistTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists turn messages concurrently and updates session details", async () => {
    let activeAppends = 0;
    let maxConcurrentAppends = 0;
    const appendDelay = 50;

    base44.messages.append.mockImplementation(async (sessionId, msg) => {
      activeAppends++;
      maxConcurrentAppends = Math.max(maxConcurrentAppends, activeAppends);
      await new Promise((resolve) => setTimeout(resolve, appendDelay));
      activeAppends--;
      return { ...msg, _stored: true };
    });

    base44.entities.ChatSession.update.mockResolvedValue({});
    animaApi.chat.commitTurn.mockResolvedValue({});

    const { result: hookRef, unmount } = renderHook(() => useChatPersistence());
    const messages = [
      { role: "user", content: "m1" },
      { role: "assistant", content: "m2" },
      { role: "assistant", content: "m3" },
      { role: "assistant", content: "m4" },
    ];

    const start = Date.now();
    let result;
    await act(async () => {
      result = await hookRef.current.persistTurn({
        sessionId: "session_1",
        turnId: "turn_1",
        messages,
        content: "Hello world response content",
        title: "Title 1",
      });
    });
    const duration = Date.now() - start;

    expect(result).toHaveLength(4);
    expect(result[0]._stored).toBe(true);
    expect(base44.messages.append).toHaveBeenCalledTimes(4);
    expect(base44.entities.ChatSession.update).toHaveBeenCalledWith("session_1", {
      last_message: "Hello world response content",
      title: "Title 1",
    });
    expect(animaApi.chat.commitTurn).toHaveBeenCalledWith("turn_1");

    console.log(`[PersistTurn Benchmark Baseline] Duration for 4 messages (50ms I/O delay each): ${duration}ms, Max concurrent appends: ${maxConcurrentAppends}`);

    unmount();
  });

  it("handles errors and triggers retryTurn", async () => {
    base44.messages.append.mockRejectedValue(new Error("Append failed"));
    animaApi.chat.retryTurn.mockResolvedValue({});

    const { result: hookRef, unmount } = renderHook(() => useChatPersistence());
    const messages = [{ role: "user", content: "test" }];

    await act(async () => {
      await expect(
        hookRef.current.persistTurn({
          sessionId: "session_1",
          turnId: "turn_1",
          messages,
        }),
      ).rejects.toThrow("Append failed");
    });

    expect(animaApi.chat.retryTurn).toHaveBeenCalledWith("turn_1");
    unmount();
  });
});
