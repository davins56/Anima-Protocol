import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import FloatingChatAnima from "./FloatingChatAnima";
import { SERENITY_PRESENCE_SRC } from "@/lib/livingPresence";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", async () => {
  const ReactActual = await import("react");
  const passthrough = ({ children, ...props }) =>
    ReactActual.createElement("div", props, children);
  return {
    motion: new Proxy(
      {},
      {
        get: () => passthrough,
      },
    ),
  };
});

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe("FloatingChatAnima", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("floats Serenity's canonical likeness around the composer", () => {
    const { container } = render(
      <FloatingChatAnima character={{ name: "Serenity", _isAnima: true }} />,
    );
    const btn = container.querySelector("[data-floating-chat-anima]");
    expect(btn).toBeTruthy();
    expect(container.querySelector("[data-floating-chat-anima-sprite]")?.getAttribute("src")).toBe(
      SERENITY_PRESENCE_SRC,
    );
  });

  it("opens the stage when clicked", () => {
    const onExpand = vi.fn();
    const { container } = render(
      <FloatingChatAnima character={{ name: "Serenity" }} onExpand={onExpand} />,
    );
    act(() => {
      container.querySelector("[data-floating-chat-anima]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
