import { describe, it, expect } from "vitest";
import {
  applyVisualViewportCssVars,
  keyboardPaddingForShell,
  measureVisualViewportInsets,
} from "./visualViewportInsets";

/**
 * Layout contract for the iOS Safari keyboard bug:
 * a black bar covered the chat text box because keyboard padding was added
 * inside a shell already sized to the visual viewport.
 */
describe("iOS keyboard composer layout contract", () => {
  const IPHONE = { layoutHeight: 844, visualHeight: 508, keyboard: 336 };

  it("keeps the composer inside the visual viewport (no black padding bar)", () => {
    const insets = measureVisualViewportInsets(
      { height: IPHONE.visualHeight, offsetTop: 0 },
      IPHONE.layoutHeight,
      { inputFocused: true },
    );

    const shellHeight = insets.visibleHeight;
    const extraPad = keyboardPaddingForShell(insets, {
      shellTracksVisualViewport: true,
    });
    const composerRoom = shellHeight - extraPad;

    expect(insets.keyboardOpen).toBe(true);
    expect(extraPad).toBe(0);
    expect(composerRoom).toBe(IPHONE.visualHeight);
    // The old hook did: shellHeight = visualHeight, padding = keyboard.
    // Content box collapsed to 508 - 336 = 172px and a 336px black pad
    // covered the text box.
    const legacyContentBox = IPHONE.visualHeight - IPHONE.keyboard;
    expect(composerRoom).toBeGreaterThan(legacyContentBox);
    expect(composerRoom).toBeGreaterThan(200);
  });

  it("does not keep home-indicator or tab-bar reservation while the keyboard is open", () => {
    const root = document.createElement("html");
    applyVisualViewportCssVars(
      root,
      measureVisualViewportInsets(
        { height: IPHONE.visualHeight, offsetTop: 0 },
        IPHONE.layoutHeight,
        { inputFocused: true },
      ),
    );
    expect(root.style.getPropertyValue("--safe-bottom")).toBe("0px");
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("0px");
    expect(root.dataset.keyboardOpen).toBe("true");
  });

  it("restores tab bar and safe-area when the keyboard closes (desktop / home indicator)", () => {
    const root = document.createElement("html");
    applyVisualViewportCssVars(
      root,
      measureVisualViewportInsets(
        { height: IPHONE.visualHeight, offsetTop: 0 },
        IPHONE.layoutHeight,
        { inputFocused: true },
      ),
    );
    applyVisualViewportCssVars(
      root,
      measureVisualViewportInsets(
        { height: IPHONE.layoutHeight, offsetTop: 0 },
        IPHONE.layoutHeight,
        { inputFocused: false },
      ),
    );
    expect(root.style.getPropertyValue("--safe-bottom")).toBe("");
    expect(root.style.getPropertyValue("--tab-bar-height")).toBe("");
    expect(root.dataset.keyboardOpen).toBeUndefined();
    expect(root.style.getPropertyValue("--app-height")).toBe("844px");
  });
});
