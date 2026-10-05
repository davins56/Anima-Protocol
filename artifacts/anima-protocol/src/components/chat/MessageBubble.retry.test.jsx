import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent } from "@testing-library/react";

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
  return { container, root };
}

const buttonNamed = (container, label) =>
  [...container.querySelectorAll("button")].find((button) =>
    button.textContent.replace(/\s+/g, " ").trim().includes(label),
  );

describe("MessageBubble retry and edit", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows a finger-sized Retry control on her reply without waiting for hover", () => {
    const onRegenerateMessage = vi.fn();
    const { container } = render({
      message: { role: "assistant", content: "I'm here.", character_name: "Serenity" },
      showRetry: true,
      onRegenerateMessage,
    });
    const retry = container.querySelector("[data-testid='retry-reply']");
    expect(retry).toBeTruthy();
    expect(retry.textContent).toContain("Retry");
    expect(retry.className).toContain("min-h-[44px]");
    expect(retry.className).not.toContain("opacity-0");
    act(() => retry.click());
    expect(onRegenerateMessage).toHaveBeenCalledTimes(1);
  });

  it("shows a finger-sized Edit control on his message", () => {
    const { container } = render({
      message: { role: "user", content: "hello" },
      showEdit: true,
      onEditMessage: vi.fn(),
    });
    const edit = container.querySelector("[data-testid='edit-message']");
    expect(edit).toBeTruthy();
    expect(edit.textContent).toContain("Edit");
    expect(edit.className).toContain("min-h-[44px]");
    expect(edit.className).not.toContain("opacity-0");
  });

  it("does not save an empty edit or request a reply", () => {
    const onEditMessage = vi.fn();
    const { container } = render({
      message: { role: "user", content: "hello" },
      showEdit: true,
      onEditMessage,
    });
    act(() => {
      container.querySelector("[data-testid='edit-message']").click();
    });
    const box = container.querySelector("textarea");
    expect(box).toBeTruthy();
    act(() => {
      fireEvent.change(box, { target: { value: "   " } });
    });
    const save = buttonNamed(container, "Save");
    expect(save.disabled).toBe(true);
    act(() => save.click());
    expect(onEditMessage).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeTruthy();
  });

  it("disables Retry and Edit while a turn is in flight or waiting", () => {
    const onRegenerateMessage = vi.fn();
    const onEditMessage = vi.fn();
    const reply = render({
      message: { role: "assistant", content: "I'm here.", character_name: "Serenity" },
      showRetry: true,
      actionsDisabled: true,
      onRegenerateMessage,
    });
    const retry = reply.container.querySelector("[data-testid='retry-reply']");
    expect(retry.disabled).toBe(true);
    act(() => retry.click());
    expect(onRegenerateMessage).not.toHaveBeenCalled();

    const user = render({
      message: { role: "user", content: "hello" },
      showEdit: true,
      actionsDisabled: true,
      onEditMessage,
    });
    const edit = user.container.querySelector("[data-testid='edit-message']");
    expect(edit.disabled).toBe(true);
    act(() => edit.click());
    expect(user.container.querySelector("textarea")).toBeNull();
    expect(onEditMessage).not.toHaveBeenCalled();
  });
});
