import { useCallback, useEffect, useRef, useState } from "react";

/** How close to the bottom (px) still counts as "following the reply". */
export const NEAR_BOTTOM_PX = 120;

/**
 * @param {{ scrollHeight: number, scrollTop: number, clientHeight: number }} el
 * @param {number} [threshold]
 */
export function isNearBottom(el, threshold = NEAR_BOTTOM_PX) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/**
 * Follow a chat thread to the bottom only while the reader is already there.
 *
 * Scrolling up (even mid-stream) stops the auto-follow; new content then
 * raises `hasUnseen` so the thread can show a "Jump to latest" chip instead
 * of yanking the reader back down. Reaching the bottom again, by hand or with
 * `jumpToLatest`, resumes following.
 *
 * Only a scroll that moves *up* can turn following off, so a smooth
 * programmatic scroll toward the bottom never trips it halfway.
 *
 * @param {import("react").RefObject<HTMLElement | null>} containerRef
 * @param {unknown} [resetKey] following resumes whenever this changes (e.g. thread id)
 */
export function useStickToBottom(containerRef, resetKey) {
  const followingRef = useRef(true);
  const lastTopRef = useRef(0);
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    followingRef.current = true;
    setHasUnseen(false);
  }, [resetKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    lastTopRef.current = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      const movedUp = top < lastTopRef.current - 1;
      lastTopRef.current = top;
      if (isNearBottom(el)) {
        followingRef.current = true;
        setHasUnseen(false);
      } else if (movedUp && followingRef.current) {
        followingRef.current = false;
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // The container mounts with the thread; re-bind when the thread changes.
  }, [containerRef, resetKey]);

  /** @param {ScrollBehavior} [behavior] */
  const scrollToBottom = useCallback(
    (behavior = "auto") => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [containerRef],
  );

  const jumpToLatest = useCallback(() => {
    followingRef.current = true;
    setHasUnseen(false);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  /** New content arrived while the reader was scrolled up. */
  const markUnseen = useCallback(() => setHasUnseen(true), []);

  /** Force following back on (the reader just sent a message). */
  const follow = useCallback(() => {
    followingRef.current = true;
    setHasUnseen(false);
  }, []);

  return { followingRef, hasUnseen, scrollToBottom, jumpToLatest, markUnseen, follow };
}
