import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/api/base44Client", () => ({
  base44: { entities: { WorldState: { list: vi.fn().mockResolvedValue([]) } } },
}));
vi.mock("@/hooks/useMemoryHighlight", () => ({
  useMemoryHighlight: () => ({ isMemoryReference: false, memoryDetail: null }),
}));
vi.mock("@/hooks/useLoreDetection", () => ({ useLoreDetection: () => ({ loreContext: [] }) }));
vi.mock("./EmotionalVoiceSynthesis", () => ({ default: () => null }));
vi.mock("./MediaLightbox", () => ({ default: () => null }));

import MessageBubble from "./MessageBubble";

function render(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MessageBubble {...props} />);
  });
  return container;
}

const teachButton = (container) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Teach"));

describe("MessageBubble teaching", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers Teach on a reply only when the steward can teach", () => {
    const reply = { role: "assistant", content: "Stars stars.", character_name: "Serenity" };
    expect(teachButton(render({ message: reply }))).toBeUndefined();

    const onTeach = vi.fn();
    const button = teachButton(render({ message: reply, onTeach }));
    expect(button).toBeDefined();
    act(() => button.click());
    expect(onTeach).toHaveBeenCalledTimes(1);
  });

  it("never offers Teach on the user's own message or a typing bubble", () => {
    const onTeach = vi.fn();
    expect(teachButton(render({ message: { role: "user", content: "hi" }, onTeach }))).toBeUndefined();
    expect(
      teachButton(render({ message: { role: "assistant", content: "...", character_name: "__typing__" }, onTeach })),
    ).toBeUndefined();
  });

  it("marks replies written by the steward's own model", () => {
    const own = render({
      message: { role: "assistant", content: "Hi.", character_name: "Serenity", llm_brand: "own" },
    });
    expect(own.textContent).toContain("your model");
    const anima = render({
      message: { role: "assistant", content: "Hi.", character_name: "Serenity", llm_brand: "anima" },
    });
    expect(anima.textContent).not.toContain("your model");
  });
});
