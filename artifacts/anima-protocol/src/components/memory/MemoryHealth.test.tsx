import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", async () => {
  const ReactActual = await import("react");
  const passthrough = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
    ReactActual.createElement("div", props, children);
  return {
    motion: new Proxy({}, { get: () => passthrough }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  };
});

const health = {
  memory_count: 1,
  first_memory_at: "2025-01-15T00:00:00.000Z",
  last_memory_at: "2026-11-14T00:00:00.000Z",
  identity_version: 3,
  last_recall_at: "2026-11-14T12:00:00.000Z",
  oldest_recent_recall: {
    event_id: "mem-1",
    age_s: 86400 * 210,
    recalled_at: "2026-11-14T12:00:00.000Z",
    content: "She kept the key",
  },
};

vi.mock("@/hooks/useMemoryHealth", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useMemoryHealth")>("@/hooks/useMemoryHealth");
  return {
    ...actual,
    useMemoryHealth: () => health,
  };
});

import MemoryHealth from "./MemoryHealth";

/** @type {{ container: HTMLElement, root: ReturnType<typeof createRoot>, clip: HTMLElement }[]} */
let mounted: { container: HTMLElement; root: ReturnType<typeof createRoot>; clip: HTMLElement }[] = [];

function renderHealth() {
  const clip = document.createElement("div");
  clip.className = "overflow-x-auto overscroll-x-contain";
  clip.style.overflow = "hidden";
  document.body.appendChild(clip);

  const container = document.createElement("div");
  clip.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryHealth characterId="char-1" characterName="Scarlett" />);
  });
  mounted.push({ container, root, clip });
  return { container, root, clip };
}

function trigger(container: HTMLElement) {
  return container.querySelector('button[aria-label="Scarlett memory health"]') as HTMLButtonElement | null;
}

async function click(element: Element | null) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

afterEach(() => {
  for (const { root, clip } of mounted) {
    act(() => {
      root.unmount();
    });
    clip.remove();
  }
  mounted = [];
  document.body.innerHTML = "";
});

describe("MemoryHealth popover", () => {
  it("portals the open panel to document.body outside overflow-hidden header chrome", async () => {
    const { container, clip } = renderHealth();
    const button = trigger(container);
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain("1");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-testid="memory-health-panel"]')).toBeNull();

    await click(button);

    const panel = document.querySelector('[data-testid="memory-health-panel"]') as HTMLElement | null;
    const backdrop = document.querySelector('[data-testid="memory-health-backdrop"]') as HTMLElement | null;
    expect(panel).toBeTruthy();
    expect(backdrop).toBeTruthy();
    expect(clip.contains(panel)).toBe(false);
    expect(clip.contains(backdrop)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
    expect(panel?.parentElement).toBe(document.body);
    expect(backdrop?.parentElement).toBe(document.body);
    expect(panel?.className).toContain("z-[1001]");
    expect(backdrop?.className).toContain("z-[1000]");
    expect(panel?.style.zIndex).toBe("1001");
    expect(backdrop?.style.zIndex).toBe("1000");
    expect(panel?.style.position).toBe("fixed");
    expect(panel?.textContent).toContain("Memory core");
    expect(panel?.textContent).toContain("1 memories");
    expect(panel?.textContent).toContain("She kept the key");
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(button?.getAttribute("aria-controls")).toBe("memory-health-panel");
  });

  it("closes on Escape and backdrop click, and returns focus to the trigger", async () => {
    const { container } = renderHealth();
    const button = trigger(container);
    await click(button);
    expect(document.querySelector('[data-testid="memory-health-panel"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="memory-health-panel"]')).toBeNull();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);

    await click(button);
    const backdrop = document.querySelector('[data-testid="memory-health-backdrop"]');
    expect(backdrop).toBeTruthy();
    await click(backdrop);
    expect(document.querySelector('[data-testid="memory-health-panel"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
