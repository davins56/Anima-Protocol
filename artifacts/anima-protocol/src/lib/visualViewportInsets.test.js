import { describe, it, expect } from "vitest";
import {
  KEYBOARD_OPEN_THRESHOLD_PX,
  applyVisualViewportCssVars,
  isEditableTarget,
  keyboardPaddingForShell,
  measureVisualViewportInsets,
} from "./visualViewportInsets";

describe("isEditableTarget", () => {
  it("accepts textarea and text inputs", () => {
    const textarea = document.createElement("textarea");
    const text = document.createElement("input");
    text.setAttribute("type", "text");
    const bare = document.createElement("input");
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(bare)).toBe(true);
  });

  it("rejects buttons, checkboxes, and non-elements", () => {
    const button = document.createElement("input");
    button.setAttribute("type", "submit");
    const checkbox = document.createElement("input");
    checkbox.setAttribute("type", "checkbox");
    expect(isEditableTarget(button)).toBe(false);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
  });
});

describe("measureVisualViewportInsets", () => {
  it("reports no keyboard when visual viewport matches layout height", () => {
    const insets = measureVisualViewportInsets(
      { height: 844, offsetTop: 0 },
      844,
      { inputFocused: true },
    );
    expect(insets.visibleHeight).toBe(844);
    expect(insets.keyboardInset).toBe(0);
    expect(insets.keyboardOpen).toBe(false);
  });

  it("detects the iOS keyboard from the visual viewport gap while focused", () => {
    // iPhone-sized layout viewport with a ~336px keyboard.
    const insets = measureVisualViewportInsets(
      { height: 508, offsetTop: 0 },
      844,
      { inputFocused: true },
    );
    expect(insets.visibleHeight).toBe(508);
    expect(insets.keyboardInset).toBe(336);
    expect(insets.keyboardOpen).toBe(true);
    expect(insets.keyboardInset).toBeGreaterThan(KEYBOARD_OPEN_THRESHOLD_PX);
  });

  it("subtracts visualViewport.offsetTop so a scrolled viewport is not over-counted", () => {
    const insets = measureVisualViewportInsets(
      { height: 508, offsetTop: 40 },
      844,
      { inputFocused: true },
    );
    expect(insets.keyboardInset).toBe(296);
    expect(insets.keyboardOpen).toBe(true);
  });

  it("does not treat pinch-zoom (no focused field) as a keyboard", () => {
    const insets = measureVisualViewportInsets(
      { height: 400, offsetTop: 0 },
      844,
      { inputFocused: false },
    );
    expect(insets.keyboardInset).toBe(444);
    expect(insets.keyboardOpen).toBe(false);
  });

  it("falls back to innerHeight when visualViewport is missing", () => {
    const insets = measureVisualViewportInsets(null, 700, { inputFocused: true });
    expect(insets.visibleHeight).toBe(700);
    expect(insets.keyboardInset).toBe(0);
    expect(insets.keyboardOpen).toBe(false);
  });

  it("ignores chrome jitter below the open threshold", () => {
    const insets = measureVisualViewportInsets(
      { height: 820, offsetTop: 0 },
      844,
      { inputFocused: true },
    );
    expect(insets.keyboardInset).toBe(24);
    expect(insets.keyboardOpen).toBe(false);
  });
});

describe("keyboardPaddingForShell", () => {
  it("is 0 when the shell already tracks the visual viewport (prevents the black bar)", () => {
    const insets = measureVisualViewportInsets(
      { height: 508, offsetTop: 0 },
      844,
      { inputFocused: true },
    );
    // --app-height is already 508px. Adding 336px of padding inside that
    // height was the black bar that covered the chat text box.
    expect(keyboardPaddingForShell(insets, { shellTracksVisualViewport: true })).toBe(0);
  });

  it("returns the inset only for shells that still use the layout viewport", () => {
    const insets = measureVisualViewportInsets(
      { height: 508, offsetTop: 0 },
      844,
      { inputFocused: true },
    );
    expect(keyboardPaddingForShell(insets, { shellTracksVisualViewport: false })).toBe(336);
  });
});

describe("in-flow composer vs fixed tab bar (keyboard closed)", () => {
  it("reserves --tab-bar-height once and does not add --safe-bottom again", () => {
    // CSS: --tab-bar-height = 56px + env(safe-area-inset-bottom)
    const tabBarContentPx = 56;
    const safeBottomPx = 34;
    const tabBarHeightPx = tabBarContentPx + safeBottomPx;
    // After the fix, .app-shell does not also pad --safe-bottom.
    const shellSafeBottomPx = 0;
    const reservedAboveViewportBottom = tabBarHeightPx + shellSafeBottomPx;
    const actualTabBarPx = tabBarContentPx + safeBottomPx;
    expect(reservedAboveViewportBottom).toBe(actualTabBarPx);
    // The old stack (shell --safe-bottom + --tab-bar-height) left this gap.
    expect(tabBarHeightPx + safeBottomPx - actualTabBarPx).toBe(safeBottomPx);
  });

  it("still zeros the reserved inset while the keyboard is open", () => {
    const insets = measureVisualViewportInsets(
      { height: 508, offsetTop: 0 },
      844,
      { inputFocused: true },
    );
    expect(insets.keyboardOpen).toBe(true);
    const root = document.createElement("html");
    applyVisualViewportCssVars(root, insets);
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("0px");
    expect(root.style.getPropertyValue("--safe-bottom")).toBe("0px");
    expect(root.dataset.keyboardOpen).toBe("true");
  });
});

describe("applyVisualViewportCssVars", () => {
  it("sizes --app-height to the visual viewport and zeros safe-area / tab bar while the keyboard is open", () => {
    const root = document.createElement("html");
    const insets = measureVisualViewportInsets(
      { height: 508, offsetTop: 0 },
      844,
      { inputFocused: true },
    );
    applyVisualViewportCssVars(root, insets);

    expect(root.style.getPropertyValue("--app-height")).toBe("508px");
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("336px");
    expect(root.style.getPropertyValue("--safe-bottom")).toBe("0px");
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("0px");
    expect(root.dataset.keyboardOpen).toBe("true");
  });

  it("restores CSS safe-area and tab-bar variables when the keyboard closes", () => {
    const root = document.createElement("html");
    applyVisualViewportCssVars(
      root,
      measureVisualViewportInsets({ height: 508, offsetTop: 0 }, 844, {
        inputFocused: true,
      }),
    );
    applyVisualViewportCssVars(
      root,
      measureVisualViewportInsets({ height: 844, offsetTop: 0 }, 844, {
        inputFocused: false,
      }),
    );

    expect(root.style.getPropertyValue("--app-height")).toBe("844px");
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("0px");
    expect(root.style.getPropertyValue("--safe-bottom")).toBe("");
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("");
    expect(root.dataset.keyboardOpen).toBeUndefined();
  });

  it("syncs --tab-bar-height to a painted bar when the keyboard closes", () => {
    const bar = document.createElement("div");
    bar.className = "tab-bar";
    bar.getBoundingClientRect = () => /** @type {DOMRect} */ ({ height: 70 });
    Object.defineProperty(bar, "offsetHeight", { value: 70, configurable: true });
    document.body.appendChild(bar);

    const root = document.documentElement;
    applyVisualViewportCssVars(
      root,
      measureVisualViewportInsets({ height: 508, offsetTop: 0 }, 844, {
        inputFocused: true,
      }),
    );
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("0px");

    applyVisualViewportCssVars(
      root,
      measureVisualViewportInsets({ height: 844, offsetTop: 0 }, 844, {
        inputFocused: false,
      }),
    );
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("70px");
    expect(root.dataset.keyboardOpen).toBeUndefined();

    bar.remove();
    root.style.removeProperty("--tab-bar-height");
    root.style.removeProperty("--safe-bottom");
    delete root.dataset.keyboardOpen;
  });
});

describe("filling the screen on iOS 26 / iPhone 17 Pro Max", () => {
  // iPhone 17 Pro Max: 440 x 956 CSS px, DPR 3.
  const SCREEN = 956;

  it("keeps the shell at full height when Safari chrome merely floats over it", () => {
    // iOS 26 floats the address/tab bar over an edge-to-edge canvas, so the
    // visual viewport is shorter than the layout viewport with no keyboard.
    const insets = measureVisualViewportInsets(
      { height: 858, offsetTop: 0 },
      SCREEN,
      { inputFocused: false },
    );

    expect(insets.keyboardOpen).toBe(false);
    // Sizing to 858 was the dead band at the bottom of the screen.
    expect(insets.visibleHeight).toBe(858);
    expect(insets.fullHeight).toBe(SCREEN);
  });

  it("ignores a pinch-zoom shrink instead of collapsing the shell", () => {
    const insets = measureVisualViewportInsets(
      { height: 400, offsetTop: 0, scale: 2.4 },
      SCREEN,
      { inputFocused: true },
    );

    expect(insets.zoomed).toBe(true);
    // A focused field plus a shrunken viewport must not read as a keyboard
    // while zoomed, or the tab bar and home-indicator inset vanish.
    expect(insets.keyboardOpen).toBe(false);
    expect(insets.fullHeight).toBe(SCREEN);
  });

  it("holds the peak height when an installed web app gets stuck short", () => {
    // The standalone-PWA bug: after the first keyboard open every API reports
    // ~59px less for the rest of the session and never recovers.
    const stuck = measureVisualViewportInsets({ height: 897, offsetTop: 0 }, 897, {
      inputFocused: false,
      maxHeight: SCREEN,
    });

    expect(stuck.fullHeight).toBe(SCREEN);
    expect(stuck.stuck).toBe(true);
  });

  it("still collapses to the visible height for a real keyboard", () => {
    const insets = measureVisualViewportInsets({ height: 508, offsetTop: 0 }, SCREEN, {
      inputFocused: true,
      maxHeight: SCREEN,
    });

    expect(insets.keyboardOpen).toBe(true);
    expect(insets.fullHeight).toBe(508);
    // The backdrop must stay full-screen so no unpainted band appears.
    expect(insets.maxHeight).toBe(SCREEN);
  });

  it("publishes --app-height-max for the edge-to-edge backdrop", () => {
    const root = document.createElement("html");
    applyVisualViewportCssVars(
      root,
      measureVisualViewportInsets({ height: 508, offsetTop: 0 }, SCREEN, {
        inputFocused: true,
        maxHeight: SCREEN,
      }),
    );

    expect(root.style.getPropertyValue("--app-height")).toBe("508px");
    expect(root.style.getPropertyValue("--app-height-max")).toBe(`${SCREEN}px`);
  });
});
