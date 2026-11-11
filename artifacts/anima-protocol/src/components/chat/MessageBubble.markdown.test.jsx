import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/api/animaClient", () => ({
  animaClient: { entities: { WorldState: { list: vi.fn().mockResolvedValue([]) } } },
}));
vi.mock("@/hooks/useMemoryHighlight", () => ({
  useMemoryHighlight: () => ({ isMemoryReference: false, memoryDetail: null }),
}));
vi.mock("@/hooks/useLoreDetection", () => ({ useLoreDetection: () => ({ loreContext: [] }) }));
vi.mock("./EmotionalVoiceSynthesis", () => ({ default: () => null }));
vi.mock("./MediaLightbox", () => ({ default: () => null }));

import MessageBubble from "./MessageBubble";
import { ROLEPLAY_ACTION_CLASS } from "./messageMarkdownUtils";

function render(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MessageBubble {...props} />);
  });
  return { container, root };
}

describe("MessageBubble markdown rendering", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders markdown and roleplay actions in a companion bubble", () => {
    const { container } = render({
      message: {
        role: "assistant",
        character_name: "Serenity",
        content: "*tucks a strand of hair* Here is `code` and a [link](https://example.com).",
      },
    });
    const em = container.querySelector("em");
    expect(em?.textContent).toBe("tucks a strand of hair");
    expect(em?.className).toBe(ROLEPLAY_ACTION_CLASS);
    expect(container.querySelector("code")?.textContent).toBe("code");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector("[data-message-bubble]")).toBeTruthy();
  });

  it("keeps the streaming caret and does not drop earlier text when a fence is still open", () => {
    const { container, root } = render({
      message: {
        role: "assistant",
        character_name: "Serenity",
        content: "Before\n```py\nprint(",
        is_streaming: true,
      },
    });
    expect(container.textContent).toContain("Before");
    expect(container.querySelector("[data-testid='message-code-block']")?.textContent).toContain("print(");
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();

    act(() => {
      root.render(
        <MessageBubble
          message={{
            role: "assistant",
            character_name: "Serenity",
            content: "Before\n```py\nprint(1)\n```",
            is_streaming: true,
          }}
        />,
      );
    });
    expect(container.textContent).toContain("Before");
    expect(container.querySelector("[data-testid='message-code-block']")?.textContent).toContain("print(1)");
  });
});
