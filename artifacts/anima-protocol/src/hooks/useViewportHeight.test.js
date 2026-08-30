import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useViewportHeight from "./useViewportHeight";

afterEach(() => {
  document.documentElement.style.removeProperty("--app-height");
  document.documentElement.style.removeProperty("--keyboard-inset");
  document.documentElement.style.removeProperty("--safe-bottom");
  document.documentElement.style.removeProperty("--tab-bar-height");
  delete document.documentElement.dataset.keyboardOpen;
  vi.unstubAllGlobals();
});

function stubViewport({ height, offsetTop = 0, innerHeight }) {
  const listeners = {};
  const visualViewport = {
    height,
    offsetTop,
    addEventListener: (event, fn) => {
      listeners[event] = fn;
    },
    removeEventListener: (event, fn) => {
      if (listeners[event] === fn) delete listeners[event];
    },
  };
  vi.stubGlobal("visualViewport", visualViewport);
  vi.stubGlobal("innerHeight", innerHeight);
  return {
    visualViewport,
    resize: (next) => {
      visualViewport.height = next.height;
      visualViewport.offsetTop = next.offsetTop ?? 0;
      listeners.resize?.();
    },
  };
}

describe("useViewportHeight", () => {
  it("sets --app-height from the visual viewport", () => {
    stubViewport({ height: 844, innerHeight: 844 });
    renderHook(() => useViewportHeight());
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("844px");
    expect(document.documentElement.dataset.keyboardOpen).toBeUndefined();
  });

  it("marks the keyboard open and zeros tab-bar / safe-area while a field is focused", () => {
    const { resize } = stubViewport({ height: 844, innerHeight: 844 });
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();

    renderHook(() => useViewportHeight());

    act(() => {
      resize({ height: 508, offsetTop: 0 });
      window.dispatchEvent(new Event("focusin"));
    });

    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("508px");
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("336px");
    expect(document.documentElement.style.getPropertyValue("--tab-bar-height")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--safe-bottom")).toBe("0px");
    expect(document.documentElement.dataset.keyboardOpen).toBe("true");

    input.remove();
  });
});
