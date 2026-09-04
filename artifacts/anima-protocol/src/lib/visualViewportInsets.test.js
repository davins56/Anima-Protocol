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
});
