// Whether a companion reply is being generated/streamed anywhere in the app.
// The service-worker update prompt reads this so it never reloads the page
// mid-reply (which would cut the stream and lose the half-painted message).

let inFlight = 0;
/** @type {Set<() => void>} */
const idleWaiters = new Set();

/** Mark a reply as started; returns a function that marks it finished. */
export function beginReply() {
  inFlight += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight === 0) {
      const waiters = [...idleWaiters];
      idleWaiters.clear();
      for (const fn of waiters) fn();
    }
  };
}

export function isReplyInFlight() {
  return inFlight > 0;
}

/**
 * Run `fn` now if no reply is in flight, otherwise once the last one ends.
 * @param {() => void} fn
 * @returns {() => void} cancel
 */
export function whenRepliesIdle(fn) {
  if (inFlight === 0) {
    fn();
    return () => {};
  }
  idleWaiters.add(fn);
  return () => idleWaiters.delete(fn);
}

/** Test helper. */
export function _resetReplyActivity() {
  inFlight = 0;
  idleWaiters.clear();
}
