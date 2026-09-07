// @ts-check
import { useEffect, useRef } from "react";
import {
  isEditableTarget,
  measureVisualViewportInsets,
} from "@/lib/visualViewportInsets";

/**
 * Scrolls a focused input into view when the virtual keyboard opens.
 *
 * Do **not** add keyboard height as `padding-bottom` on the app shell.
 * `useViewportHeight` already sets `--app-height` to `visualViewport.height`,
 * so extra padding double-counts the keyboard and paints a black bar over
 * the chat composer on iOS Safari.
 *
 * @param {{ current: HTMLElement | null } | null} [_containerRef]
 */
export function useKeyboardAvoidance(_containerRef) {
  const rafRef = useRef(/** @type {number | null} */ (null));
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const insets = measureVisualViewportInsets(vv, window.innerHeight, {
          inputFocused: isEditableTarget(document.activeElement),
        });

        if (insets.keyboardOpen && !wasOpenRef.current) {
          const focused = document.activeElement;
          if (isEditableTarget(focused)) {
            focused.scrollIntoView({ block: "nearest", behavior: "auto" });
          }
        }
        wasOpenRef.current = insets.keyboardOpen;
      });
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);

    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);
}
