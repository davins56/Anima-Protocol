import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MessageBubble from "@/components/chat/MessageBubble";
import { useDivergentPaths } from "@/hooks/useDivergentPaths";
import { useLoreKeywordScanning } from "@/hooks/useLoreKeywordScanning";
import { base44 } from "@/api/base44Client";
import {
  resetLocalOnlyLlmChainForTests,
  setLocalOnlyLlmChainForTests,
} from "@/lib/localOnlyLlm";

vi.mock("@/api/base44Client", () => ({
  base44: {
    functions: {
      invoke: vi.fn(async () => ({ data: { context: [], paths: [], linked_messages: [] } })),
    },
    entities: {
      WorldState: {
        list: vi.fn(async () => []),
      },
    },
  },
  FUNCTION_INVOKE_TIMEOUT_MS: 12_000,
}));

function Transcript({ messages }) {
  useLoreKeywordScanning("sess-flood", messages);
  useDivergentPaths("sess-flood", "char-1", "Nova", messages);
  return (
    <div>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} sessionId="sess-flood" />
      ))}
    </div>
  );
}

function finishedMessages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Finished line ${index} about the harbor light.`,
    character_name: index % 2 === 0 ? "You" : "Nova",
    timestamp: new Date().toISOString(),
  }));
}

describe("local-only chat transcript", () => {
  let container;
  let root;

  beforeEach(() => {
    setLocalOnlyLlmChainForTests(true);
    base44.functions.invoke.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetLocalOnlyLlmChainForTests();
  });

  it("makes zero model invokes for a 20-message list plus a streamed reply", async () => {
    const streaming = {
      id: "msg-stream",
      role: "assistant",
      content: "",
      character_name: "Nova",
      is_streaming: true,
      timestamp: new Date().toISOString(),
    };
    const messages = [...finishedMessages(20), streaming];

    await act(async () => {
      root.render(<Transcript messages={messages} />);
    });

    const tokens = ["H", "He", "Hel", "Hello", "Hello from the harbor"];
    for (const content of tokens) {
      streaming.content = content;
      await act(async () => {
        root.render(<Transcript messages={[...finishedMessages(20), { ...streaming, content }]} />);
      });
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    expect(base44.functions.invoke).not.toHaveBeenCalled();
  });
});
