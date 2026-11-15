/**
 * Which browser origins may call the API with credentials.
 *
 * The API used to echo back any `Origin` with `Access-Control-Allow-Credentials`,
 * which lets any website make credentialed requests on a signed-in visitor's
 * behalf. Only these origins get CORS headers now:
 *
 * - the request's own host (same-origin, including PR preview hosts)
 * - anima-protocol.com, www., and clerk.
 * - localhost / 127.0.0.1 / [::1] on any port, **outside production only**
 *   (local dev). In production (`NODE_ENV=production`, set in wrangler.jsonc)
 *   a loopback origin gets no CORS headers, so a local app or dev server on a
 *   visitor's machine cannot make credentialed calls (security audit
 *   2026-11-14, L1). `ANIMA_CORS_ALLOW_LOOPBACK=1` re-enables it on purpose.
 * - Capacitor / Ionic native shells (`capacitor://localhost`, `ionic://localhost`)
 * - anything listed in `ANIMA_CORS_ALLOWED_ORIGINS` (comma-separated, exact origins)
 *
 * Other origins get no CORS headers, so the browser blocks the response.
 */

const ANIMA_ORIGINS = new Set([
  "https://anima-protocol.com",
  "https://www.anima-protocol.com",
  "https://clerk.anima-protocol.com",
]);

const NATIVE_SHELL_ORIGINS = new Set(["capacitor://localhost", "ionic://localhost"]);

const LOOPBACK_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function extraAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = String(env.ANIMA_CORS_ALLOWED_ORIGINS || "");
  return new Set(
    raw
      .split(",")
      .map(normalizeOrigin)
      .filter(Boolean),
  );
}

/** Loopback origins are a dev convenience; production refuses them by default. */
export function allowsLoopbackOrigins(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = String(env.ANIMA_CORS_ALLOW_LOOPBACK || "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return String(env.NODE_ENV || "").trim().toLowerCase() !== "production";
}

export function isAllowedCorsOrigin(
  origin: string | undefined | null,
  requestHost?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof origin !== "string" || !origin.trim()) return false;
  const normalized = normalizeOrigin(origin);
  if (normalized === "null") return false;

  if (ANIMA_ORIGINS.has(normalized)) return true;
  if (NATIVE_SHELL_ORIGINS.has(normalized)) return true;
  if (LOOPBACK_RE.test(normalized)) return allowsLoopbackOrigins(env);
  if (extraAllowedOrigins(env).has(normalized)) return true;

  // Same-origin: the browser still sends Origin on same-host POSTs. HTTPS
  // only, so a plain-HTTP page on the same host cannot read API responses.
  // (Loopback HTTP is handled above: dev only.)
  const host = String(requestHost || "").trim().toLowerCase();
  if (host) {
    try {
      const url = new URL(normalized);
      if (url.protocol === "https:" && url.host === host) return true;
    } catch {
      return false;
    }
  }
  return false;
}
