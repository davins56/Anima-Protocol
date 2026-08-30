// @ts-check
import { useEffect } from "react";
import {
  applyVisualViewportCssVars,
  isEditableTarget,
  measureVisualViewportInsets,
} from "@/lib/visualViewportInsets";

/**
 * Keeps `--app-height` / `--vh` in sync with the *visible* viewport and
 * publishes `--keyboard-inset` when a focused field is occluded.
 *
 * Mobile browsers report `100vh` as the LARGE viewport — the height with the
 * address/navigation chrome hidden — so fixed-height and `vh`-based layouts get
 * clipped behind the bottom toolbar. We measure `window.visualViewport`
 * (falling back to `window.innerHeight`).
 *
 * The shell uses `height: var(--app-height)`, so the keyboard is already
 * accounted for. Do **not** also add the keyboard height as padding — that
 * double-count painted the black bar over the chat composer on iOS Safari.
 *
 * Mount once near the app root.
 */
export default function useViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;

    const update = () => {
      const insets = measureVisualViewportInsets(
        window.visualViewport,
        window.innerHeight,
        { inputFocused: isEditableTarget(document.activeElement) },
      );
      applyVisualViewportCssVars(root, insets);
    };

    update();

    const vp = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    vp?.addEventListener("resize", update);
    vp?.addEventListener("scroll", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
      vp?.removeEventListener("resize", update);
      vp?.removeEventListener("scroll", update);
    };
  }, []);
}
