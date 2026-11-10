// Service-worker update flow: a new deploy installs in the background and
// then *waits*; the app shows "Update available" and only reloads when the
// reader taps Reload — and never while a reply is streaming.
import { whenRepliesIdle } from "@/lib/replyActivity";

export const SW_UPDATE_EVENT = "anima:sw-update-available";

/** @type {((reload?: boolean) => Promise<void>) | null} */
let updateSW = null;
let updateReady = false;

/**
 * @param {(opts: { immediate?: boolean, onNeedRefresh?: () => void, onOfflineReady?: () => void }) => (reload?: boolean) => Promise<void>} registerSW
 */
export function initServiceWorker(registerSW) {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady = true;
      if (typeof window !== "undefined") window.dispatchEvent(new Event(SW_UPDATE_EVENT));
    },
  });
}

export function isUpdateReady() {
  return updateReady;
}

/**
 * Activate the waiting worker and reload, after any in-flight reply ends.
 * @returns {boolean} true when it had to wait for a reply to finish
 */
export function applyUpdate() {
  let waited = true;
  whenRepliesIdle(() => {
    waited = false;
    void updateSW?.(true);
  });
  return waited;
}

/** Test helper. */
export function _setUpdateSW(fn, ready = true) {
  updateSW = fn;
  updateReady = ready;
}
