// API origin for all browser → backend fetch calls. Defaults to same-origin
// `/api` (Replit full-stack, local Vite proxy, or Vercel rewrite). Override at
// build time with VITE_API_ORIGIN when the API is hosted on a different host
// without a reverse proxy (e.g. https://anima-protocol.replit.app).
export function getApiOrigin() {
  const configured = import.meta.env.VITE_API_ORIGIN;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim().replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

export function apiUrl(path) {
  const base = getApiOrigin();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}/api${suffix}`;
}

/**
 * Rebuild an API URL after a host bounce (www → apex) that dropped the path.
 *
 * Live Cloudflare currently 301s `https://www.anima-protocol.com/api/*` to
 * `https://anima-protocol.com/` (apex root). fetch() then follows as GET `/`
 * and the Worker never sees POST /api/storage/uploads.
 */
export function resolveRedirectedApiUrl(requestUrl, locationHeader) {
  if (!locationHeader || typeof locationHeader !== "string") return null;
  try {
    const original = new URL(requestUrl, "https://anima-protocol.com");
    const loc = new URL(locationHeader, original);
    if (loc.pathname.startsWith("/api")) {
      loc.search = loc.search || original.search;
      return loc.toString();
    }
    loc.pathname = original.pathname;
    loc.search = original.search;
    return loc.toString();
  } catch {
    return null;
  }
}
