// @ts-check
import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Typeset TeX with KaTeX. This module is lazy-loaded, so KaTeX and its CSS
 * stay out of the initial Chat chunk. Output is KaTeX's own HTML with
 * `trust: false` (no raw user HTML).
 *
 * @param {{ expr: string, display?: boolean }} props
 */
export default function MessageMath({ expr, display = false }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(expr || "", {
        displayMode: Boolean(display),
        throwOnError: false,
        trust: false,
        strict: "ignore",
        maxSize: 10,
        maxExpand: 1000,
      });
    } catch {
      return "";
    }
  }, [expr, display]);

  if (!html) {
    return (
      <span className="font-mono text-primary/70" data-testid="message-math">
        {expr}
      </span>
    );
  }

  if (display) {
    return (
      <div
        className="md-math-display my-1.5 overflow-x-auto text-primary/85"
        data-testid="message-math"
        data-display="true"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <span
      className="md-math-inline text-primary/85"
      data-testid="message-math"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
