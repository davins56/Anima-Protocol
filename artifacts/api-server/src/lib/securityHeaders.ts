/**
 * Browser security headers and the http → https redirect (security audit
 * 2026-11-14, H2).
 *
 * Where each piece is applied:
 * - `artifacts/anima-protocol/public/_headers` (`/*`): every static asset and
 *   SPA document served straight from Cloudflare Workers Assets (paths not in
 *   `run_worker_first`). Keep it in sync with `DOCUMENT_SECURITY_HEADERS`;
 *   test/securityHeaders.test.ts checks that.
 * - Express (`securityHeadersMiddleware`, app.ts): every API response, on the
 *   Worker and on Node / Cloud Run.
 * - worker.ts: `/assets/*` responses (run_worker_first) and the redirect.
 * - index.ts (Node / Cloud Run only): the SPA documents it serves itself.
 *
 * The document CSP ships as **Content-Security-Policy-Report-Only** first.
 * index.html has an inline theme script and an inline `onload` handler, the
 * codespace runs Pyodide (eval / wasm) and blob: workers, and Clerk, Mixpanel,
 * fonts and media hosts load at runtime, so an enforced CSP risks breaking
 * sign-in or the codespace. Violations are posted to `/api/csp-report` and
 * logged. Switching to an enforced CSP (ideally with a hash for the inline
 * theme script instead of 'unsafe-inline') is a follow-up once the reports
 * are clean; it is not part of this change.
 *
 * API responses get an enforced, locked-down CSP (`default-src 'none'`):
 * JSON is never a document, so nothing legitimate needs to load from it.
 */

/** One year. `includeSubDomains`, no `preload` (preload is a separate, sticky decision). */
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

const CLERK_HOSTS = ["https://clerk.anima-protocol.com", "https://*.clerk.accounts.dev", "https://*.clerk.com"];

/** Report-only document policy. Tight where it is safe, permissive where the app needs it today. */
export const DOCUMENT_CSP_REPORT_ONLY = [
  "default-src 'self'",
  [
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
    ...CLERK_HOSTS,
    "https://challenges.cloudflare.com",
    "https://cdn.jsdelivr.net",
    "https://js.stripe.com",
  ].join(" "),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  [
    "connect-src 'self' blob: data:",
    ...CLERK_HOSTS,
    "https://api-js.mixpanel.com",
    "https://api.mixpanel.com",
    "https://api.open-meteo.com",
    "https://cdn.jsdelivr.net",
    "https://codeload.github.com",
    "https://*.algolia.net",
    "https://*.algolianet.com",
    "https://fal.media",
    "https://*.fal.media",
    "wss://api.x.ai",
  ].join(" "),
  "frame-src 'self' blob: https://challenges.cloudflare.com https://js.stripe.com https://checkout.stripe.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "report-uri /api/csp-report",
].join("; ");

/** Enforced on API responses: JSON is never rendered as a document. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * Microphone (voice) and geolocation (weather / explore) are used by the app
 * itself; everything else is off, including for embedded frames.
 */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=(self)",
  "geolocation=(self)",
  "payment=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "bluetooth=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=(self)",
  "accelerometer=(self)",
  "display-capture=()",
].join(", ");

const COMMON_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": HSTS_VALUE,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/** Headers for HTML documents and static assets. Mirrored in public/_headers. */
export const DOCUMENT_SECURITY_HEADERS: Record<string, string> = {
  ...COMMON_HEADERS,
  "X-Frame-Options": "DENY",
  "Permissions-Policy": PERMISSIONS_POLICY,
  "Content-Security-Policy-Report-Only": DOCUMENT_CSP_REPORT_ONLY,
};

/** Headers for JSON API responses. */
export const API_SECURITY_HEADERS: Record<string, string> = {
  ...COMMON_HEADERS,
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": API_CSP,
};

/**
 * The Clerk proxy relays Clerk's own Frontend API (scripts, handshake
 * redirects). Do not impose our CSP / frame rules on it; transport headers only.
 */
export const CLERK_PROXY_SECURITY_HEADERS: Record<string, string> = { ...COMMON_HEADERS };

export type SecurityHeaderKind = "document" | "api" | "clerk-proxy";

export function securityHeadersFor(kind: SecurityHeaderKind): Record<string, string> {
  if (kind === "api") return API_SECURITY_HEADERS;
  if (kind === "clerk-proxy") return CLERK_PROXY_SECURITY_HEADERS;
  return DOCUMENT_SECURITY_HEADERS;
}

export function securityHeaderKindForPath(pathname: string): SecurityHeaderKind {
  if (pathname === "/api/__clerk" || pathname.startsWith("/api/__clerk/")) return "clerk-proxy";
  if (pathname === "/api" || pathname.startsWith("/api/")) return "api";
  return "document";
}

/** Copy of `response` with the security headers set (existing values are replaced). */
export function withSecurityHeaders(response: Response, kind: SecurityHeaderKind): Response {
  // 101 (WebSocket upgrade) and other special responses must pass through untouched.
  if (response.status === 101 || (response as Response & { webSocket?: unknown }).webSocket) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeadersFor(kind))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * 301 (GET/HEAD) or 308 (other methods, keeps the body) from http to https.
 * Null for https, and for loopback hosts so `wrangler dev` keeps working.
 */
export function httpsRedirectFor(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:") return null;
  if (LOCAL_HOSTS.has(url.hostname.toLowerCase())) return null;
  url.protocol = "https:";
  url.port = "";
  const method = request.method.toUpperCase();
  return new Response(null, {
    status: method === "GET" || method === "HEAD" ? 301 : 308,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "Strict-Transport-Security": HSTS_VALUE,
    },
  });
}

type HeaderSink = { setHeader: (name: string, value: string) => unknown };

export function applySecurityHeaders(res: HeaderSink, kind: SecurityHeaderKind): void {
  for (const [name, value] of Object.entries(securityHeadersFor(kind))) res.setHeader(name, value);
}

/** Express middleware: API / Clerk-proxy headers by path, set before any handler writes. */
export function securityHeadersMiddleware(
  req: { path?: string; originalUrl?: string; url?: string },
  res: HeaderSink,
  next: () => void,
): void {
  const raw = req.originalUrl || req.url || req.path || "/";
  const pathname = raw.split("?")[0] || "/";
  applySecurityHeaders(res, securityHeaderKindForPath(pathname));
  next();
}
