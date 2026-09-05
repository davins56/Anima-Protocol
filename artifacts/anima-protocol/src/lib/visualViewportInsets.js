// @ts-check

import { syncReservedTabBarHeight } from "./tabBarLayout";

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
 * `visualViewport.scale` above this counts as pinch-zoom. Zooming shrinks
 * `visualViewport.height` exactly like the keyboard does, so without this guard
 * the shell collapses to the zoomed region and the UI stops filling the screen.
 */
export const ZOOM_SCALE_EPSILON = 1.01;

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
 *   fullHeight: number,
 *   maxHeight: number,
 *   offsetTop: number,
 *   keyboardInset: number,
 *   keyboardOpen: boolean,
 *   zoomed: boolean,
 *   stuck: boolean,
 * }} VisualViewportInsets
 */

/**
 * Measure how much of the layout viewport is occluded below the visual
 * viewport (the virtual keyboard on iOS/Android).
 *
 * @param {{ height?: number, offsetTop?: number, scale?: number } | null | undefined} visualViewport
 * @param {number} innerHeight  `window.innerHeight` (layout viewport)
 * @param {{ inputFocused?: boolean, maxHeight?: number }} [options]
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

  const scale =
    visualViewport && Number.isFinite(visualViewport.scale) ? visualViewport.scale : 1;
  const zoomed = scale > ZOOM_SCALE_EPSILON;

  // Pinch-zoom also shrinks visualViewport. Require a focused field so we do
  // not hide the tab bar or drop the home-indicator inset while zooming.
  const keyboardOpen =
    inputFocused && !zoomed && keyboardInset > KEYBOARD_OPEN_THRESHOLD_PX;

  // Largest height this viewport has ever reported. iOS 26 Safari floats its
  // address/tab bar over an edge-to-edge canvas, and an installed web app can
  // get *stuck* reporting the post-keyboard height for the rest of the session
  // (e.g. 956 -> 897 on an iPhone Pro Max). Both cases leave a dead band at the
  // bottom of a shell sized from `visualViewport.height`, so remember the peak.
  const observedMax = Math.max(
    Number.isFinite(options.maxHeight) ? Number(options.maxHeight) : 0,
    layoutHeight,
    // A zoomed visual viewport is smaller than the layout viewport by
    // definition; never let it raise or lower the recorded peak.
    zoomed ? 0 : visibleHeight,
  );

  return {
    visibleHeight,
    // Height the shell should occupy: the keyboard genuinely steals space, but
    // browser chrome that merely floats over the page must not shrink the UI.
    fullHeight: keyboardOpen ? visibleHeight : observedMax,
    maxHeight: observedMax,
    offsetTop,
    keyboardInset,
    keyboardOpen,
    zoomed,
    // The viewport is reporting short with no keyboard and no zoom to explain
    // it — the WebKit "stuck viewport" state a reflow can heal.
    stuck: !keyboardOpen && !zoomed && observedMax - layoutHeight > 4,
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
 * are not reserved *and* painted on top of the visual viewport. When it is
 * closed, `--tab-bar-height` is synced to the painted `.tab-bar` (or the
 * CSS fallback if the bar has not laid out yet).
 *
 * @param {HTMLElement} root
 * @param {VisualViewportInsets} insets
 */
export function applyVisualViewportCssVars(root, insets) {
  // `fullHeight` equals `visibleHeight` while the keyboard is open, and the
  // peak (edge-to-edge) height otherwise, so floating iOS 26 browser chrome
  // and the stuck-viewport bug can no longer shrink the shell.
  const appHeight = Number.isFinite(insets.fullHeight)
    ? insets.fullHeight
    : insets.visibleHeight;

  root.style.setProperty("--app-height", `${appHeight}px`);
  root.style.setProperty("--vh", `${appHeight * 0.01}px`);
  // Always the full screen height, even mid-keyboard — for the backdrop layer
  // that must stay painted behind translucent browser chrome.
  root.style.setProperty(
    "--app-height-max",
    `${Number.isFinite(insets.maxHeight) ? insets.maxHeight : appHeight}px`,
  );
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
    // Match reservation to the painted bar (iPad / every width). Do not
    // leave a leftover 0px from the keyboard-open path, and do not invent
    // 0px just because a desktop media query used to zero the var.
    syncReservedTabBarHeight(root, { keyboardOpen: false });
  }
}
