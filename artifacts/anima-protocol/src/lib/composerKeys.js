import { useEffect, useState } from "react";

/** Touch-first device: no hover and a coarse primary pointer (phones, most tablets without a trackpad). */
export const TOUCH_FIRST_QUERY = "(hover: none) and (pointer: coarse)";

export function isTouchFirst() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(TOUCH_FIRST_QUERY).matches;
}

/** Tracks TOUCH_FIRST_QUERY (it flips when an iPad attaches a trackpad keyboard). */
export function useTouchFirst() {
  const [touchFirst, setTouchFirst] = useState(isTouchFirst);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(TOUCH_FIRST_QUERY);
    const update = () => setTouchFirst(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return touchFirst;
}

/**
 * Whether a keydown in the chat composer should send.
 *
 * - Desktop: Enter sends, Shift+Enter is a newline (unchanged).
 * - Touch-first: Enter inserts a newline; the send button sends. A phone's
 *   return key is right next to the letters, so it used to fire half-written
 *   messages, and there was no way to type a line break.
 * - Cmd/Ctrl+Enter sends everywhere (hardware keyboards on tablets).
 * - Never while an IME is composing (Japanese/Chinese/Korean input confirms
 *   a candidate with Enter).
 *
 * @param {{ key: string, shiftKey?: boolean, metaKey?: boolean, ctrlKey?: boolean, isComposing?: boolean, keyCode?: number, nativeEvent?: { isComposing?: boolean } }} e
 * @param {boolean} touchFirst
 */
export function shouldSendOnEnter(e, touchFirst) {
  if (!e || e.key !== "Enter") return false;
  if (e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return false;
  if (e.metaKey || e.ctrlKey) return true;
  if (e.shiftKey) return false;
  return !touchFirst;
}

/** The hint under the composer. */
export function composerHint(touchFirst) {
  return touchFirst
    ? "Tap send to send · Return for a new line"
    : "Enter to send · Shift+Enter for newline";
}
