// @ts-check
import { useLayoutEffect, useState } from "react";
import { computeAnchoredFixedStyle } from "@/lib/anchoredFixedPanel";

/**
 * Keep a fixed panel pinned to an anchor element across open / resize / scroll.
 *
 * @param {React.RefObject<Element | null>} anchorRef
 * @param {boolean} open
 * @param {{ align?: "left" | "right", maxHeightRatio?: number, gap?: number }} [options]
 */
export default function useAnchoredFixedPosition(anchorRef, open, options = {}) {
  const [style, setStyle] = useState(
    /** @type {ReturnType<typeof computeAnchoredFixedStyle> | null} */ (null),
  );
  const align = options.align === "left" ? "left" : "right";
  const maxHeightRatio = options.maxHeightRatio;
  const gap = options.gap;

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return undefined;
    }

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      setStyle(
        computeAnchoredFixedStyle(el.getBoundingClientRect(), {
          align,
          maxHeightRatio,
          gap,
        }),
      );
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, [open, anchorRef, align, maxHeightRatio, gap]);

  return style;
}
