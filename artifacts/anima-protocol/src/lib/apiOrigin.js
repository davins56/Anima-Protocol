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
