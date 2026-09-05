// @ts-check

/**
 * Keep `--tab-bar-height` in sync with the *painted* bottom tab bar.
 *
 * The reservation must match visibility, not a breakpoint. BottomTabBar is
 * `position: fixed` at every width (no `lg:hidden`), so a
 * `@media (min-width: 1024px) { --tab-bar-height: 0 }` rule covers the
 * in-flow chat composer on iPad. Keyboard-open still wins: that path
 * hides `.fixed-bottom-chrome` and zeroes the var.
 */

export const TAB_BAR_SELECTOR = ".tab-bar";

/**
 * @typedef {{
 *   present: boolean,
 *   visible: boolean,
 *   height: number | null,
 * }} TabBarMeasurement
 */

/**
 * @param {Element | null | undefined} tabBar
 * @returns {TabBarMeasurement}
 */
export function measureVisibleTabBarHeight(tabBar) {
  if (!tabBar) {
    return { present: false, visible: false, height: null };
  }

  let style = null;
  try {
    style =
      typeof getComputedStyle === "function" ? getComputedStyle(tabBar) : null;
  } catch {
    style = null;
  }
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return { present: true, visible: false, height: 0 };
  }

  const rectHeight =
    typeof tabBar.getBoundingClientRect === "function"
      ? tabBar.getBoundingClientRect().height
      : 0;
  const offsetHeight =
    "offsetHeight" in tabBar && typeof tabBar.offsetHeight === "number"
      ? tabBar.offsetHeight
      : 0;
  const height = rectHeight || offsetHeight || 0;

  return { present: true, visible: true, height };
}

/**
 * Write `--tab-bar-height` from a measurement. Keyboard-open always zeroes.
 * A visible bar with height 0 (jsdom / first layout) keeps the CSS fallback
 * instead of collapsing the reservation.
 *
 * @param {HTMLElement} root
 * @param {TabBarMeasurement} measurement
 * @param {{ keyboardOpen?: boolean }} [options]
 */
export function applyReservedTabBarHeight(root, measurement, options = {}) {
  if (options.keyboardOpen) {
    root.style.setProperty("--tab-bar-height", "0px");
    return;
  }

  if (!measurement.present) {
    root.style.removeProperty("--tab-bar-height");
    return;
  }

  if (!measurement.visible) {
    root.style.setProperty("--tab-bar-height", "0px");
    return;
  }

  if (Number.isFinite(measurement.height) && measurement.height > 0) {
    root.style.setProperty(
      "--tab-bar-height",
      `${Math.round(measurement.height)}px`,
    );
    return;
  }

  root.style.removeProperty("--tab-bar-height");
}

/**
 * Measure the painted `.tab-bar` (if any) and apply `--tab-bar-height`.
 *
 * @param {HTMLElement} root
 * @param {{ keyboardOpen?: boolean }} [options]
 * @returns {TabBarMeasurement}
 */
export function syncReservedTabBarHeight(root, options = {}) {
  const doc = root.ownerDocument || document;
  const fromRoot =
    typeof root.querySelector === "function"
      ? root.querySelector(TAB_BAR_SELECTOR)
      : null;
  const tabBar = fromRoot || doc.querySelector(TAB_BAR_SELECTOR);
  const measurement = measureVisibleTabBarHeight(tabBar);
  applyReservedTabBarHeight(root, measurement, options);
  return measurement;
}
