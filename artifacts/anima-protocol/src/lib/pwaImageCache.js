/**
 * Which image requests the service worker may serve CacheFirst (30 days).
 *
 * Only stable, unsigned image files qualify: the app's own `public/` art
 * (avatars, icons, presence webps) and plain third-party image files. These
 * never qualify, because a cached copy goes stale or turns into a 403:
 *   - anything under `/api/` (photo files, vessel snapshot / model 302s,
 *     `/api/storage/objects/*`, `/api/character-image`) — the API sets its own
 *     Cache-Control and the browser HTTP cache honours it;
 *   - Supabase Storage URLs other than `/object/public/` and
 *     `/render/image/public/` (signed, authenticated, upload);
 *   - any URL carrying a signature or token query param (`token`,
 *     `X-Amz-Signature`, `X-Goog-Signature`, `Signature`, `Expires`, `sig`, …);
 *   - any URL with a query string at all (same as the old anchored regex);
 *   - 3D model files (`.glb`, `.gltf`, `.vrm`) — not image extensions.
 *
 * Excluded requests get no service-worker route, so the browser fetches them
 * itself: network-only, with native redirect, CORS and range handling.
 *
 * Workbox serializes this function into the generated sw.js with
 * `Function.prototype.toString()`, so it must stay self-contained: no imports,
 * no references to module-level constants.
 *
 * @param {{ url: URL | string }} options Workbox route-match context.
 * @returns {boolean}
 */
export function isCacheFirstImageUrl({ url }) {
  let parsed;
  try {
    parsed =
      typeof url === "string"
        ? new URL(url, "https://anima-protocol.com")
        : new URL(String(url && url.href ? url.href : url));
  } catch (_err) {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const path = parsed.pathname.toLowerCase();
  if (/^\/api(?:\/|$)/.test(path)) return false;
  if (
    path.indexOf("/storage/v1/") !== -1 &&
    path.indexOf("/storage/v1/object/public/") === -1 &&
    path.indexOf("/storage/v1/render/image/public/") === -1
  ) {
    return false;
  }
  const signed = /^(?:token|signature|sig|expires|key-pair-id|policy|x-amz-[a-z-]+|x-goog-[a-z-]+|se|sp|sv|st|skoid)$/;
  for (const key of parsed.searchParams.keys()) {
    if (signed.test(key.toLowerCase())) return false;
  }
  if (parsed.search) return false;
  return /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/.test(path);
}
