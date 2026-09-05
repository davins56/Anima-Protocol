/**
 * Vite hashed chunks that SPA-fell-back to HTML throw a module MIME error.
 * Remounting cannot heal that — the import URL is still the stale hash.
 *
 * One cache-clear + hard-reload per tab session is enough to pick up the
 * current index hashes (EchoKeys-07j-In6E.js). A second MIME failure must
 * show the ErrorBoundary panel, not loop reloads.
 *
 * Generic "Failed to fetch dynamically imported module" / CORS / network
 * errors are NOT this path — those are often transient connectivity, not a
 * poisoned HTML-as-JS response.
 */

export const STALE_CHUNK_RECOVERY_KEY = "anima:stale-chunk-recovery";

export function isStaleChunkError(error) {
  const msg = (error && (error.message || String(error))) || "";
  return /is not a valid JavaScript MIME type/i.test(msg);
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
