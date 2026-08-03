// @ts-check
import { useEffect, useRef } from "react";

/**
 * Adjusts the main app container's bottom padding when the virtual keyboard
 * opens on mobile, so inputs are never obscured by the BottomTabBar or keyboard.
 *
 * Uses the Visual Viewport API (supported on iOS 13+ and Android Chrome).
 * @param {{ current: HTMLElement | null }} containerRef
 */
export function useKeyboardAvoidance(containerRef) {
  const rafRef = useRef(/** @type {number | null} */ (null));

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // Desktop / unsupported — no-op

    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const el = containerRef?.current;
        if (!el) return;

        // How much the keyboard has pushed the viewport up
        const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
        const kb = Math.max(0, keyboardHeight);

        // Only apply if keyboard is actually visible (> 80px heuristic)
        if (kb > 80) {
          el.style.paddingBottom = `${kb}px`;
          // Scroll the focused input into view
          const focused = document.activeElement;
          if (focused && focused !== document.body) {
            setTimeout(() => focused.scrollIntoView({ block: "nearest", behavior: "smooth" }), 100);
          }
        } else {
          el.style.paddingBottom = "";
        }
      });
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);

    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef]);
}