/**
 * Vite hashed chunks 404 (or, before the Worker fix, SPA-fell-back to HTML).
 * React.lazy then throws a MIME / "Failed to fetch dynamically imported module"
 * error. Remounting the tree cannot heal that — the import URL is still stale.
 * Unregister the PWA SW, drop Cache Storage, and hard-reload so the next
 * navigation picks up the current index.html hashes.
 */

export function isStaleChunkError(error) {
  const msg = (error && (error.message || String(error))) || "";
  return (
    /is not a valid JavaScript MIME type/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
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

export async function recoverStaleChunk() {
  try {
    await unregisterServiceWorkers();
    await clearCacheStorage();
  } catch {
    /* still reload — a stuck SW is worse than a noisy unregister */
  }
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
