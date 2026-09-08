import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
import { logger } from "../lib/logger";
import { decodeClerkFrontendHost } from "../lib/clerkDiagnostics";
import { readRuntimeEnv } from "../lib/cloudflareEnv";
import {
  ANIMA_APEX_HOST,
  CLERK_PROXY_PATH,
  canonicalClerkProxyHeaderHost,
  getClerkProxyHost,
  isClerkOwnedHostname,
  isLocalDevHost,
} from "./clerkProxyHosts";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
/** Public production host — www 301s here. Dashboard proxy/CNAME must match apex. */
const PRODUCTION_PROXY_HOST = ANIMA_APEX_HOST;
const UPSTREAM_TIMEOUT_MS = 25_000;

/** Safe to forward from the browser — skip hop-by-hop and forbidden fetch headers. */
const FORWARD_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
  "cookie",
  "referer",
] as const;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function normalizeHostname(host: string | undefined): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

export function resolveClerkUpstreamPath(
  req: IncomingMessage & { originalUrl?: string },
): string {
  const url = req.url || "";
  if (
    url.startsWith("/v1/") ||
    url.startsWith("/v1") ||
    url.startsWith("/npm/")
  ) {
    return url;
  }

  const original = req.originalUrl || "";
  const marker = CLERK_PROXY_PATH;
  const markerIndex = original.indexOf(marker);
  if (markerIndex >= 0) {
    const suffix = original.slice(markerIndex + marker.length);
    return suffix.startsWith("/") ? suffix : `/${suffix}`;
  }

  return url || "/v1/environment";
}

/**
 * FAPI origin for this instance. A custom-domain key (clerk.anima-protocol.com)
 * must be proxied to that host — frontend-api.clerk.dev returns host_invalid
 * when the dashboard is CNAME-only and has no Proxy URL.
 */
export function clerkFrontendApiBaseFromPublishableKey(
  publishableKey?: string,
): string {
  const host = decodeClerkFrontendHost(
    publishableKey ?? readRuntimeEnv("CLERK_PUBLISHABLE_KEY"),
  );
  return host ? `https://${host}` : CLERK_FAPI;
}

export function clerkFrontendApiHostFromBase(frontendApiBase: string): string {
  try {
    return new URL(frontendApiBase).hostname;
  } catch {
    return "frontend-api.clerk.dev";
  }
}

export function usesOfficialClerkProxyProtocol(frontendApiBase: string): boolean {
  return clerkFrontendApiHostFromBase(frontendApiBase) === "frontend-api.clerk.dev";
}

export function resolveClerkUpstreamUrl(
  requestUrl: string | undefined,
  frontendApiBase: string = CLERK_FAPI,
): URL {
  const path = requestUrl?.startsWith("/")
    ? requestUrl
    : `/${requestUrl ?? ""}`;
  return new URL(path, frontendApiBase);
}

/**
 * Drop Domain= on Clerk FAPI cookies so the browser stores them on the app
 * origin (same-origin /api/__clerk). Safari ITP treats CNAME-cloaked
 * clerk.anima-protocol.com cookies as third-party and never sends them.
 */
export function rewriteClerkProxySetCookie(
  raw: string,
  appHost: string,
): string | null {
  const domainMatch = raw.match(/;\s*Domain=([^;]*)/i);
  if (!domainMatch) return raw;
  const cookieDomain = domainMatch[1].trim().replace(/^\./, "").toLowerCase();
  const app = appHost.toLowerCase().replace(/^\./, "");
  const appApex = app.replace(/^www\./, "");

  if (isClerkOwnedHostname(cookieDomain)) {
    // Session cookies must become first-party. Drop Cloudflare bot cookies
    // minted for Clerk's CNAME target — they are not used by clerk-js.
    if (/^__(?:client|session)/i.test(raw.trim())) {
      return raw.replace(/;\s*Domain=[^;]*/i, "");
    }
    return null;
  }
  if (
    cookieDomain === app ||
    cookieDomain === appApex ||
    cookieDomain === `www.${appApex}`
  ) {
    return raw.replace(/;\s*Domain=[^;]*/i, `; Domain=${appApex}`);
  }
  return null;
}

/** Clerk FAPI / clerk-js asset paths that must stay on `/api/__clerk`. */
export function isClerkFrontendApiPath(pathname: string): boolean {
  const path = pathname || "/";
  return path === "/v1" || path.startsWith("/v1/") || path === "/npm" || path.startsWith("/npm/");
}

export function isClerkNpmAssetPath(pathname: string): boolean {
  const path = (pathname || "/").split("?")[0] || "/";
  return path === "/npm" || path.startsWith("/npm/");
}

export function isHttpRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/** Cap Clerk dist-tag hops (`@6` → `@6.31.0`) so a loop cannot hang the isolate. */
export const MAX_CLERK_NPM_REDIRECTS = 5;

/**
 * Follow only clerk-js CDN dist-tag redirects. Do not follow OAuth / handshake
 * Locations (GitHub, `/sign-in/sso-callback`) — those must reach the browser.
 */
export function resolveClerkNpmRedirectUrl(
  location: string | null | undefined,
  currentUrl: URL,
  fapiHost: string,
): URL | null {
  if (!location) return null;
  try {
    const next = new URL(location, currentUrl);
    const host = next.hostname.toLowerCase();
    const allowed =
      host === fapiHost.toLowerCase() || isClerkOwnedHostname(host);
    if (!allowed) return null;
    if (!isClerkNpmAssetPath(next.pathname)) return null;
    return next;
  } catch {
    return null;
  }
}

/**
 * Keep FAPI XHR/asset redirects on the same-origin proxy. Document returns
 * (OAuth handshake, `/`, `/sign-in/sso-callback`) must land on the SPA —
 * mapping those to `/api/__clerk/?__clerk_handshake=` drops the session.
 */
export function rewriteClerkProxyLocation(
  location: string,
  opts: { fapiHost: string; appOrigin: string; proxyPath?: string },
): string {
  const proxyPath = opts.proxyPath ?? CLERK_PROXY_PATH;
  try {
    const url = new URL(location, `https://${opts.fapiHost}`);
    if (
      url.hostname === opts.fapiHost ||
      isClerkOwnedHostname(url.hostname)
    ) {
      if (isClerkFrontendApiPath(url.pathname)) {
        return `${opts.appOrigin}${proxyPath}${url.pathname}${url.search}${url.hash}`;
      }
      const path = url.pathname || "/";
      return `${opts.appOrigin}${path}${url.search}${url.hash}`;
    }
    return location;
  } catch {
    return location;
  }
}

function productionProxyHostFallback(): string {
  const publishableKey = readRuntimeEnv("CLERK_PUBLISHABLE_KEY") || "";
  return publishableKey.startsWith("pk_live_") ? PRODUCTION_PROXY_HOST : "";
}

/** First hop only — Vercel/CF may send "https,https" or "https, http". */
export function forwardedRequestProto(
  headers: IncomingHttpHeaders,
): "http" | "https" {
  const raw = headers["x-forwarded-proto"];
  const first = (Array.isArray(raw) ? raw[0] : raw)
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return first === "http" ? "http" : "https";
}

export function buildClerkProxyHeaderValues(
  req: { headers: IncomingHttpHeaders },
  secretKey: string,
): { proxyUrl: string; origin: string; host: string } {
  const requestHost = normalizeHostname(getClerkProxyHost(req) || "");
  const usePublicProxy =
    isLocalDevHost(requestHost) &&
    readRuntimeEnv("CLERK_PUBLISHABLE_KEY")?.startsWith("pk_live_");

  const protocol = usePublicProxy ? "https" : forwardedRequestProto(req.headers);
  const host =
    (usePublicProxy
      ? PRODUCTION_PROXY_HOST
      : canonicalClerkProxyHeaderHost(getClerkProxyHost(req))) ||
    productionProxyHostFallback() ||
    requestHost;

  const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}/`;
  const origin = host ? `${protocol}://${host}` : "";

  return { proxyUrl, origin, host };
}

function clientIpFromHeaders(headers: IncomingHttpHeaders): string {
  const xff = headers["x-forwarded-for"];
  return (
    (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
    (typeof headers["x-real-ip"] === "string" ? headers["x-real-ip"] : "") ||
    ""
  );
}

export function buildClerkUpstreamHeaders(
  req: { headers: IncomingHttpHeaders; method?: string },
  secretKey: string,
  options: { officialProxy?: boolean } = {},
): Headers {
  const officialProxy = options.officialProxy !== false;
  const { proxyUrl, origin } = buildClerkProxyHeaderValues(req, secretKey);
  const headers = new Headers();

  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }

  if (officialProxy) {
    headers.set("Clerk-Proxy-Url", proxyUrl);
    headers.set("Clerk-Secret-Key", secretKey.trim());
  }
  if (origin) {
    headers.set("Origin", origin);
  }

  const clientIp = clientIpFromHeaders(req.headers);
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
  }

  return headers;
}

function upstreamAbortSignal(): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  return controller.signal;
}

async function readRequestBody(
  req: IncomingMessage,
): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

const DROP_UPSTREAM_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-expose-headers",
  "content-security-policy",
]);

function collectSetCookies(upstream: Response): string[] {
  const headers = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie();
    if (cookies.length > 0) return cookies;
  }
  const single = upstream.headers.get("set-cookie");
  return single ? [single] : [];
}

export function forwardClerkProxyResponseHeaders(
  upstream: Response,
  res: ServerResponse,
  rewrite: { appHost: string; appOrigin: string; fapiHost: string },
): void {
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (DROP_UPSTREAM_HEADERS.has(lower)) return;
    if (lower === "set-cookie") return;
    if (lower === "location") {
      res.setHeader(
        name,
        rewriteClerkProxyLocation(value, {
          fapiHost: rewrite.fapiHost,
          appOrigin: rewrite.appOrigin,
        }),
      );
      return;
    }
    res.setHeader(name, value);
  });

  for (const cookie of collectSetCookies(upstream)) {
    const rewritten = rewriteClerkProxySetCookie(cookie, rewrite.appHost);
    if (rewritten) {
      appendSetCookie(res, rewritten);
    }
  }
}

function appendSetCookie(res: ServerResponse, value: string): void {
  if (typeof res.appendHeader === "function") {
    res.appendHeader("set-cookie", value);
    return;
  }
  const prev = res.getHeader("set-cookie");
  if (prev === undefined) {
    res.setHeader("set-cookie", value);
    return;
  }
  const list = Array.isArray(prev) ? prev.map(String) : [String(prev)];
  res.setHeader("set-cookie", [...list, value]);
}

export async function proxyClerkWithFetch(
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const frontendApiBase = clerkFrontendApiBaseFromPublishableKey();
  const officialProxy = usesOfficialClerkProxyProtocol(frontendApiBase);
  const fapiHost = clerkFrontendApiHostFromBase(frontendApiBase);
  const { origin, host } = buildClerkProxyHeaderValues(req, secretKey);
  const upstreamPath = resolveClerkUpstreamPath(req);
  let upstreamUrl = resolveClerkUpstreamUrl(upstreamPath, frontendApiBase);
  const headers = buildClerkUpstreamHeaders(req, secretKey, { officialProxy });
  const body = await readRequestBody(req);
  const method = req.method?.toUpperCase() || "GET";
  const payloadBody = body ? new Uint8Array(body) : undefined;

  let upstream = await fetchImpl(upstreamUrl, {
    method,
    headers,
    body: payloadBody,
    redirect: "manual",
    signal: upstreamAbortSignal(),
  });

  // Clerk serves `/npm/@clerk/clerk-js@6/...` as 307 → `@6.31.0`. Script tags
  // (and our connectivity probe) need 200 JS, not a Location hop.
  let npmHops = 0;
  while (
    isClerkNpmAssetPath(upstreamUrl.pathname) &&
    isHttpRedirectStatus(upstream.status) &&
    npmHops < MAX_CLERK_NPM_REDIRECTS
  ) {
    const next = resolveClerkNpmRedirectUrl(
      upstream.headers.get("location"),
      upstreamUrl,
      fapiHost,
    );
    if (!next) break;
    npmHops += 1;
    await upstream.arrayBuffer().catch(() => undefined);
    upstreamUrl = next;
    upstream = await fetchImpl(next, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: upstreamAbortSignal(),
    });
  }

  res.statusCode = upstream.status;
  forwardClerkProxyResponseHeaders(upstream, res, {
    appHost: host,
    appOrigin: origin,
    fapiHost,
  });

  const payload = Buffer.from(await upstream.arrayBuffer());
  res.end(payload);
}

export async function handleClerkProxyRequest(
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
  secretKey: string,
): Promise<void> {
  try {
    await proxyClerkWithFetch(req, res, secretKey);
  } catch (err) {
    const cause =
      err instanceof Error && "cause" in err && err.cause instanceof Error
        ? err.cause.message
        : undefined;
    logger.error(
      { err, url: req.url, originalUrl: req.originalUrl, cause },
      "Clerk proxy upstream fetch failed",
    );
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: "clerk_proxy_upstream_failed",
          message:
            err instanceof Error
              ? cause
                ? `${err.message}: ${cause}`
                : err.message
              : "Could not reach Clerk Frontend API",
        }),
      );
    }
  }
}
