import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback whose identity never changes but always runs the latest `fn`.
 *
 * Chat.jsx defines most handlers inline, so their identity changes on every
 * render (every streamed token). Passing them through this keeps memoized
 * children (the Story Feed, the composer, message bubbles) from re-rendering
 * just because a parent closure was recreated. Only for event handlers: the
 * ref is updated in a layout effect, so do not call the result during render.
 *
 * @template {(...args: any[]) => any} T
 * @param {T | null | undefined} fn
 * @returns {T}
 */
export function useStableCallback(fn) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return /** @type {T} */ (useCallback((...args) => ref.current?.(...args), []));
}
