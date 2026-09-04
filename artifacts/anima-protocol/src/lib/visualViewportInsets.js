// @ts-check

/**
 * Visual-viewport measurements for mobile keyboard avoidance.
 *
 * iOS Safari reports `100vh` / `window.innerHeight` as the *layout* viewport.
 * The virtual keyboard shrinks `window.visualViewport` instead. The app shell
 * already sizes to `--app-height` (= visual viewport height), so adding the
 * keyboard inset again as padding paints a black bar over the composer.
 */

/** Occlusion (px) treated as a virtual keyboard rather than chrome jitter. */
export const KEYBOARD_OPEN_THRESHOLD_PX = 80;

/**
 * @param {EventTarget | Element | null | undefined} el
 * @returns {el is HTMLElement}
 */
export function isEditableTarget(el) {
  if (!el || /** @type {Node} */ (el).nodeType !== 1) return false;
  const node = /** @type {HTMLElement} */ (el);
  const tag = node.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = String(node.getAttribute("type") || "text").toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
  }
  return node.isContentEditable === true;
}

/**
 * @typedef {{
 *   visibleHeight: number,
 *   offsetTop: number,
 *   keyboardInset: number,
 *   keyboardOpen: boolean,
 * }} VisualViewportInsets
 */

/**
 * Measure how much of the layout viewport is occluded below the visual
 * viewport (the virtual keyboard on iOS/Android).
 *
 * @param {{ height?: number, offsetTop?: number } | null | undefined} visualViewport
 * @param {number} innerHeight  `window.innerHeight` (layout viewport)
 * @param {{ inputFocused?: boolean }} [options]
 * @returns {VisualViewportInsets}
 */
export function measureVisualViewportInsets(visualViewport, innerHeight, options = {}) {
  const layoutHeight = Number.isFinite(innerHeight) ? innerHeight : 0;
  const visibleHeight =
    visualViewport && Number.isFinite(visualViewport.height)
      ? visualViewport.height
      : layoutHeight;
  const offsetTop =
    visualViewport && Number.isFinite(visualViewport.offsetTop)
      ? visualViewport.offsetTop
      : 0;

  // Remainder of the layout viewport below the visual viewport. On iOS Safari
  // this is the keyboard; offsetTop is how far the visual viewport scrolled.
  const keyboardInset = Math.max(0, layoutHeight - visibleHeight - offsetTop);
  const inputFocused = options.inputFocused === true;

  return {
    visibleHeight,
    offsetTop,
    keyboardInset,
    // Pinch-zoom also shrinks visualViewport. Require a focused field so we
    // do not hide the tab bar or drop the home-indicator inset while zooming.
    keyboardOpen: inputFocused && keyboardInset > KEYBOARD_OPEN_THRESHOLD_PX,
  };
}

/**
 * Extra bottom padding for a container that is *not* already sized to the
 * visual viewport. Always 0 when the shell uses `--app-height`, because
 * adding `keyboardInset` would double-count and cover the text box.
 *
 * @param {Pick<VisualViewportInsets, "keyboardInset" | "keyboardOpen">} insets
 * @param {{ shellTracksVisualViewport?: boolean }} [options]
 */
export function keyboardPaddingForShell(insets, options = {}) {
  if (options.shellTracksVisualViewport) return 0;
  return insets.keyboardOpen ? insets.keyboardInset : 0;
}

/**
 * Apply measured insets to `:root`. When the keyboard is open, zero
 * `--tab-bar-height` and `--safe-bottom` so the home indicator and tab bar
 * are not reserved *and* painted on top of the visual viewport.
 *
 * @param {HTMLElement} root
 * @param {VisualViewportInsets} insets
 */
export function applyVisualViewportCssVars(root, insets) {
  root.style.setProperty("--app-height", `${insets.visibleHeight}px`);
  root.style.setProperty("--vh", `${insets.visibleHeight * 0.01}px`);
  root.style.setProperty(
    "--keyboard-inset",
    `${insets.keyboardOpen ? insets.keyboardInset : 0}px`,
  );

  if (insets.keyboardOpen) {
    root.dataset.keyboardOpen = "true";
    // Keyboard replaces the home indicator; keep the closed-state CSS values
    // when we clear these so desktop / safe-area layout is unchanged.
    root.style.setProperty("--safe-bottom", "0px");
    root.style.setProperty("--tab-bar-height", "0px");
  } else {
    delete root.dataset.keyboardOpen;
    root.style.removeProperty("--safe-bottom");
    root.style.removeProperty("--tab-bar-height");
  }
}
