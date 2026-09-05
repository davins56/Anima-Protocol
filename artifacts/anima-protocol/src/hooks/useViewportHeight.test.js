import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useViewportHeight from "./useViewportHeight";

afterEach(() => {
  document.documentElement.style.removeProperty("--app-height");
  document.documentElement.style.removeProperty("--app-height-max");
  document.documentElement.style.removeProperty("--vh");
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

describe("useViewportHeight — filling an iPhone 17 Pro Max screen", () => {
  const SCREEN = 956;

  /** Stub a 440x956 portrait iPhone whose height we can drive. */
  function stubPhone({ height = SCREEN, innerHeight = SCREEN, innerWidth = 440 } = {}) {
    const listeners = {};
    const visualViewport = {
      height,
      offsetTop: 0,
      addEventListener: (event, fn) => {
        listeners[event] = fn;
      },
      removeEventListener: (event, fn) => {
        if (listeners[event] === fn) delete listeners[event];
      },
    };
    vi.stubGlobal("visualViewport", visualViewport);
    vi.stubGlobal("innerHeight", innerHeight);
    vi.stubGlobal("innerWidth", innerWidth);

    return {
      /** Change both viewports, as a real resize does. */
      resize: ({ height: h, innerHeight: ih, innerWidth: iw }) => {
        if (h !== undefined) visualViewport.height = h;
        if (ih !== undefined) vi.stubGlobal("innerHeight", ih);
        if (iw !== undefined) vi.stubGlobal("innerWidth", iw);
        listeners.resize?.();
      },
    };
  }

  const appHeight = () =>
    document.documentElement.style.getPropertyValue("--app-height");

  it("holds the peak height when the viewport is stuck short with no keyboard", () => {
    const { resize } = stubPhone();
    renderHook(() => useViewportHeight());
    expect(appHeight()).toBe(`${SCREEN}px`);

    // The stuck-viewport bug: every API now reports 59px less, forever.
    act(() => resize({ height: 897, innerHeight: 897 }));

    // Previously this produced a permanent dead band at the bottom.
    expect(appHeight()).toBe(`${SCREEN}px`);
  });

  it("resets the peak after rotation so landscape is not over-tall", () => {
    const { resize } = stubPhone();
    renderHook(() => useViewportHeight());
    expect(appHeight()).toBe(`${SCREEN}px`);

    // Rotate to landscape: 440x956 -> 956x440. The portrait peak must not leak.
    act(() => resize({ height: 440, innerHeight: 440, innerWidth: 956 }));

    expect(appHeight()).toBe("440px");
  });

  it("keeps the backdrop full-screen while the keyboard is open", () => {
    const { resize } = stubPhone();
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();

    renderHook(() => useViewportHeight());
    act(() => {
      resize({ height: 508 });
      window.dispatchEvent(new Event("focusin"));
    });

    expect(appHeight()).toBe("508px");
    expect(
      document.documentElement.style.getPropertyValue("--app-height-max"),
    ).toBe(`${SCREEN}px`);

    input.remove();
  });

  it("heals a stuck viewport with a reflow and restores the shell's display", () => {
    vi.useFakeTimers();
    try {
      const { resize } = stubPhone();
      const shell = document.createElement("div");
      shell.className = "app-shell";
      shell.style.display = "flex";
      document.body.appendChild(shell);

      const input = document.createElement("textarea");
      document.body.appendChild(input);
      input.focus();

      renderHook(() => useViewportHeight());

      // Keyboard opens, then closes leaving the viewport stuck short.
      act(() => {
        resize({ height: 508 });
        window.dispatchEvent(new Event("focusin"));
      });
      act(() => {
        input.blur();
        resize({ height: 897, innerHeight: 897 });
        window.dispatchEvent(new Event("focusout"));
        vi.advanceTimersByTime(200);
      });

      // The reflow must leave the shell exactly as it found it.
      expect(shell.style.display).toBe("flex");
      expect(appHeight()).toBe(`${SCREEN}px`);

      shell.remove();
      input.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
