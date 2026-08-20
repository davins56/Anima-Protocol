import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillStyle: "",
}));
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

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
    AnimatePresence: ({ children }) => children,
  };
});

import LivingPresence from "./LivingPresence";
import LivingPresenceStage from "./LivingPresenceStage";

const korra = {
  id: "char_1",
  name: "Korra",
  avatar_url: "/seed-avatars/korra.jpg",
  build: "athletic",
};

const mountedRoots = new Set();

function render(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.add(root);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots) {
      root.unmount();
    }
  });
  mountedRoots.clear();
  document.body.innerHTML = "";
});

describe("LivingPresence", () => {
  it("renders the companion name, emotion, and portrait", () => {
    const { container } = render(
      <LivingPresence character={korra} emotion="joyful" speaking={false} />,
    );
    expect(container.textContent).toContain("Korra");
    expect(container.querySelector("[data-living-presence]")?.getAttribute("data-emotion")).toBe("joyful");
    expect(container.querySelector("[data-presence-sprite]")?.getAttribute("src")).toBe(korra.avatar_url);
  });

  it("marks speaking state and calls onExpand", () => {
    const onExpand = vi.fn();
    const { container } = render(
      <LivingPresence character={korra} speaking onExpand={onExpand} />,
    );
    expect(container.querySelector("[data-living-presence]")?.getAttribute("data-speaking")).toBe("true");
    const btn = container.querySelector("button");
    act(() => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("uses the canonical Serenity illustration when she has no custom body", () => {
    const { container } = render(
      <LivingPresence character={{ id: "x", name: "Serenity" }} />,
    );
    expect(container.textContent).toContain("Serenity");
    expect(container.querySelector("[data-living-presence]")?.getAttribute("data-presence-kind")).toBe("serenity");
    expect(container.querySelector("[data-presence-sprite]")?.getAttribute("src")).toBe(
      "/serenity-presence.webp",
    );
  });

  it("falls back to an initial when a story character has no portrait", () => {
    const { container } = render(
      <LivingPresence character={{ id: "x", name: "Korra" }} />,
    );
    expect(container.textContent).toContain("K");
    expect(container.querySelector("[data-presence-sprite]")).toBeNull();
  });
});

describe("LivingPresenceStage", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <LivingPresenceStage open={false} onClose={() => {}} onSend={() => {}} cast={[korra]} />,
    );
    expect(container.querySelector("[data-living-presence-stage]")).toBeNull();
  });

  it("shows the last companion line and sends from the speak bar", () => {
    const onSend = vi.fn();
    const { container } = render(
      <LivingPresenceStage
        open
        onClose={() => {}}
        onSend={onSend}
        cast={[korra]}
        characterEmotions={{ char_1: { emotion: "hopeful", intensity: 7 } }}
        messages={[
          { role: "assistant", character_name: "Korra", content: "The Avatar state is not a joke." },
        ]}
      />,
    );
    expect(container.querySelector("[data-living-presence-stage]")).toBeTruthy();
    expect(container.querySelector("[data-stage-dialogue]")?.textContent).toContain("Avatar state");
    expect(container.textContent).toContain("Korra");

    const input = container.querySelector('input[name="stage-line"]');
    const form = container.querySelector("form");
    expect(input).toBeTruthy();
    act(() => {
      if (input instanceof HTMLInputElement) input.value = "I know.";
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSend).toHaveBeenCalledWith("I know.");
  });
});
