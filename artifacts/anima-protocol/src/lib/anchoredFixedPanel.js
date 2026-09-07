/**
 * Viewport-fixed coordinates for menus that must escape overflow-hidden
 * ancestors (chat chrome) and sit above the bottom tab bar.
 */

export const ANCHORED_PANEL_GAP = 4;
export const ANCHORED_PANEL_EDGE_PAD = 8;
export const ANCHORED_PANEL_MAX_HEIGHT_RATIO = 0.7;

/**
 * Resolve a CSS length (including custom properties) to CSS pixels.
 * @param {string} cssLength
 * @param {number} [fallbackPx]
 */
export function measureCssLengthPx(cssLength, fallbackPx = 0) {
  if (typeof document === "undefined") return fallbackPx;
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:${cssLength}`;
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) && height >= 0 ? height : fallbackPx;
}

/** Space reserved for the bottom tab bar + home-indicator safe area. */
export function readTabBarReservePx() {
  if (typeof document !== "undefined") {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--tab-bar-height")
      .trim();
    const pxMatch = raw.match(/^(-?[\d.]+)px$/);
    if (pxMatch) return Number(pxMatch[1]);
  }
  const measured = measureCssLengthPx("var(--tab-bar-height, 56px)", 56);
  // jsdom reports 0 for unresolved calc()/var heights; keep the mobile default.
  return measured > 0 ? measured : 56;
}

/**
 * @param {Pick<DOMRect, "bottom" | "left" | "right">} anchorRect
 * @param {{
 *   align?: "left" | "right",
 *   gap?: number,
 *   maxHeightRatio?: number,
 *   viewportWidth?: number,
 *   viewportHeight?: number,
 *   tabBarReserve?: number,
 *   edgePad?: number,
 * }} [options]
 */
export function computeAnchoredFixedStyle(anchorRect, options = {}) {
  const align = options.align === "left" ? "left" : "right";
  const gap = options.gap ?? ANCHORED_PANEL_GAP;
  const maxHeightRatio = options.maxHeightRatio ?? ANCHORED_PANEL_MAX_HEIGHT_RATIO;
  const viewportWidth = options.viewportWidth ?? window.innerWidth;
  const viewportHeight =
    options.viewportHeight ??
    window.visualViewport?.height ??
    window.innerHeight;
  const tabBarReserve = options.tabBarReserve ?? readTabBarReservePx();
  const edgePad = options.edgePad ?? ANCHORED_PANEL_EDGE_PAD;

  const top = Math.round(anchorRect.bottom + gap);
  const availableBelow = viewportHeight - top - tabBarReserve - edgePad;
  const vhCap = viewportHeight * maxHeightRatio;
  const maxHeight = Math.min(vhCap, Math.max(0, availableBelow));

  /** @type {{ position: "fixed", top: number, maxHeight: number, left?: number, right?: number }} */
  const style = {
    position: "fixed",
    top,
    maxHeight,
  };

  if (align === "right") {
    style.right = Math.max(edgePad, viewportWidth - anchorRect.right);
  } else {
    style.left = Math.max(edgePad, anchorRect.left);
  }

  return style;
}
