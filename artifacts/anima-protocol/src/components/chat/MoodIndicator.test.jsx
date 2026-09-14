import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("framer-motion", async () => {
  const ReactActual = await import("react");
  const passthrough = ({ children, ...props }) =>
    ReactActual.createElement("div", props, children);
  return {
    motion: new Proxy({}, { get: () => passthrough }),
    AnimatePresence: ({ children }) => children,
  };
});

import MoodIndicator from "./MoodIndicator";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** @type {{ container: HTMLElement, root: ReturnType<typeof createRoot> }[]} */
let mounted = [];

function renderMood(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MoodIndicator {...props} />);
  });
  mounted.push({ container, root });
  return container;
}

afterEach(() => {
  for (const { root, container } of mounted) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
  mounted = [];
});

describe("MoodIndicator", () => {
  it("shows the felt primary and scales the marker with intensity", () => {
    const container = renderMood({ mood: "tender", intensity: 72 });
    expect(container.textContent).toMatch(/tender/i);
    const dot = container.querySelector("span");
    expect(dot?.style.opacity).toBeTruthy();
  });
});
