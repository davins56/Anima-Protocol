/**
 * Vite hashed chunks that SPA-fell-back to HTML throw a module MIME error.
 * Remounting cannot heal that — the import URL is still the stale hash.
 *
 * Safari/iPad reports the same class of failure as
 * "Importing a module script failed." (no MIME string). A user hard-reload
 * does not unregister the service worker, which can keep intercepting
 * /assets/*.js even after the network response is 200 text/javascript.
 *
 * One unregister-SW + cache-clear + hard-reload per tab session is enough
 * to pick up the current index hashes. A second failure must show the
 * ErrorBoundary panel, not loop reloads.
 *
 * Generic "Failed to fetch dynamically imported module" / network errors
 * are NOT this path — those are often transient connectivity.
 */

export const STALE_CHUNK_RECOVERY_KEY = "anima:stale-chunk-recovery";

function errorMessage(error) {
  return (error && (error.message || String(error))) || "";
}

export function isStaleChunkError(error) {
  return /is not a valid JavaScript MIME type/i.test(errorMessage(error));
}

export function isSafariModuleScriptError(error) {
  return /Importing a module script failed/i.test(errorMessage(error));
}

export function isRecoverableModuleError(error) {
  return isStaleChunkError(error) || isSafariModuleScriptError(error);
}

export function hasAttemptedStaleChunkRecovery() {
  try {
    return sessionStorage.getItem(STALE_CHUNK_RECOVERY_KEY) === "1";
  } catch {
    return false;
  }
}

export function markStaleChunkRecoveryAttempted() {
  try {
    sessionStorage.setItem(STALE_CHUNK_RECOVERY_KEY, "1");
  } catch {
    /* private mode / blocked storage */
  }
}

async function unregisterServiceWorkers() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.getRegistrations) {
    return;
  }
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((reg) => reg.unregister()));
}

async function clearCacheStorage() {
  if (typeof caches === "undefined" || !caches.keys) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

/**
 * @returns {Promise<boolean>} true if a reload was started
 */
export async function recoverStaleChunk() {
  if (hasAttemptedStaleChunkRecovery()) return false;
  markStaleChunkRecoveryAttempted();
  try {
    await unregisterServiceWorkers();
    await clearCacheStorage();
  } catch {
    /* still reload — a stuck SW is worse than a noisy unregister */
  }
  if (typeof window !== "undefined") {
    window.location.reload();
  }
  return true;
}
