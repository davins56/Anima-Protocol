export const ANIMA_APEX_HOST = "anima-protocol.com";
export const ANIMA_WWW_HOST = `www.${ANIMA_APEX_HOST}`;

export function isAnimaWwwHost(hostname: string | null | undefined): boolean {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  return host === ANIMA_WWW_HOST;
}

/**
 * Canonical apex URL that keeps pathname + query + hash.
 * Live bug: www `/api/store/Character` 301'd to `https://anima-protocol.com/`
 * (path dropped). Never emit a host-only Location.
 */
export function apexUrlPreservingPath(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.protocol = "https:";
  url.hostname = ANIMA_APEX_HOST;
  url.port = "";
  return url.toString();
}

/**
 * Path-preserving 308 for www → apex. 308 keeps POST /api/store method.
 * Returns null when the request is already on apex or another host.
 */
export function apexRedirectForWww(request: Request): Response | null {
  const url = new URL(request.url);
  if (!isAnimaWwwHost(url.hostname)) return null;
  return new Response(null, {
    status: 308,
    headers: {
      Location: apexUrlPreservingPath(request.url),
      "cache-control": "no-store",
    },
  });
}
