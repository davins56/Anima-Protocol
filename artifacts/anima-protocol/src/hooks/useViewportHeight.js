// @ts-check
import { useEffect } from "react";
import {
  applyVisualViewportCssVars,
  isEditableTarget,
  measureVisualViewportInsets,
} from "@/lib/visualViewportInsets";

/**
 * Keeps `--app-height` / `--app-height-max` / `--vh` in sync with the screen and
 * publishes `--keyboard-inset` when a focused field is occluded.
 *
 * Sizing the shell from `visualViewport.height` alone under-fills the screen in
 * three separate ways, all of which show up as a dead band at the bottom:
 *
 *   1. iOS 26 ("Liquid Glass") floats the Safari address/tab bar *over* an
 *      edge-to-edge canvas. `visualViewport.height` excludes that floating
 *      chrome, so the UI stops short of the display edge.
 *   2. Pinch-zoom shrinks `visualViewport.height` exactly like the keyboard.
 *   3. An installed web app can get stuck reporting the post-keyboard height
 *      for the rest of the session (~956 -> 897 on an iPhone 17 Pro Max).
 *
 * So we track the *peak* reported height per orientation and size the shell to
 * that, collapsing to the visible height only for a genuine keyboard. Case 3
 * additionally needs a nudge: toggling `display` on a full-height element forces
 * WebKit to recompute the viewport.
 *
 * Mount once near the app root.
 */
export default function useViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;

    // Peak height is only comparable within one orientation — rotating to
    // landscape legitimately shortens the viewport, so the peak resets.
    let maxHeight = 0;
    let maxHeightWidth = window.innerWidth;
    let lastInsets = null;

    const update = () => {
      if (window.innerWidth !== maxHeightWidth) {
        maxHeightWidth = window.innerWidth;
        maxHeight = 0;
      }

      const insets = measureVisualViewportInsets(
        window.visualViewport,
        window.innerHeight,
        {
          inputFocused: isEditableTarget(document.activeElement),
          maxHeight,
        },
      );

      maxHeight = insets.maxHeight;
      lastInsets = insets;
      applyVisualViewportCssVars(root, insets);
    };

    /**
     * Force WebKit to re-measure a viewport that is stuck short. Hiding and
     * restoring a full-height element in the same frame triggers a reflow with
     * no paint in between, so this is invisible to the user.
     */
    const healStuckViewport = () => {
      update();
      if (!lastInsets?.stuck) return;

      const shell = /** @type {HTMLElement | null} */ (
        document.querySelector(".app-shell")
      );
      if (!shell) return;

      const previous = shell.style.display;
      shell.style.display = "none";
      // Read a layout property to flush the reflow synchronously.
      void shell.offsetHeight;
      shell.style.display = previous;
      update();
    };

    update();

    // The keyboard closing is what leaves the viewport stuck, so re-measure a
    // beat after focus leaves a field rather than on the focusout tick itself.
    const onFocusOut = () => {
      update();
      window.setTimeout(healStuckViewport, 140);
    };

    const vp = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", onFocusOut);
    vp?.addEventListener("resize", update);
    vp?.addEventListener("scroll", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", onFocusOut);
      vp?.removeEventListener("resize", update);
      vp?.removeEventListener("scroll", update);
    };
  }, []);
}
