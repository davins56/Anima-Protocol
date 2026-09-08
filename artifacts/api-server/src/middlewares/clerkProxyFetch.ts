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
  // CNAME FAPI (clerk.anima-protocol.com) is not a dashboard Proxy URL.
  // Clerk-Proxy-Url / X-Forwarded-Host on that host 400 /v1/client with
  // host_invalid. Official headers belong only on frontend-api.clerk.dev.
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

/** Cookie name from a Set-Cookie or Cookie pair (`name=value`). */
export function clerkCookieName(raw: string): string {
  return raw.split("=", 1)[0]?.trim() || "";
}

/** Clerk cookies that identify a client/session (includes `__client_uat*`). */
export function isClerkAuthCookieName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n.startsWith("__client") ||
    n.startsWith("__session") ||
    n.startsWith("__refresh")
  );
}

/**
 * The ProductionBrowser client token. Exact `__client` only — never
 * `__client_uat*`. Clerk's CNAME `/v1/oauth_callback` authenticates with
 * this cookie (OpenAPI `ProductionBrowser`).
 */
export function isClerkClientTokenCookieName(name: string): boolean {
  return name.trim().toLowerCase() === "__client";
}

/**
 * Non-HttpOnly GitHub leftover. Safe to Domain=apex expire.
 * Never treat `__client` / `__session` / `__refresh` as UAT leftovers —
 * on anima-protocol.com, `Domain=apex; Max-Age=0` also deletes the
 * session cookie of the same name (Chrome/Safari collapse Domain=exact-host).
 */
export function isClerkClientUatCookieName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "__client_uat" || n.startsWith("__client_uat_");
}

function withCookieDomain(raw: string, domain: string | null): string {
  const stripped = raw.replace(/;\s*Domain=[^;]*/gi, "");
  if (!domain) return stripped;
  return `${stripped}; Domain=${domain}`;
}

/**
 * Rewrite Clerk FAPI Set-Cookie onto the app origin.
 *
 * `__client` must use `Domain={apex}` so GitHub's top-level hop to
 * `clerk.{apex}/v1/oauth_callback` receives the client that started OAuth.
 * Host-only `__client` (the #406 rewrite) is invisible to that CNAME —
 * live: no `__client` → 301 `err_code=authorization_invalid` → 403 JSON
 * matching the user error. A real `__client` + `state` + `code` (no UAT)
 * 303s to `/sign-in/sso-callback` instead. The cookie is still first-party
 * (Set-Cookie on `/api/__clerk`); Safari ITP only treats CNAME-cloaked
 * cookies minted on `clerk.{apex}` as third-party.
 *
 * `__client_uat*` stays host-only. Domain=apex UAT on the CNAME hop is a
 * separate failure (live: valid `__client` + leftover `__client_uat=0` →
 * 301 authorization_invalid). The SPA still preclears those leftovers.
 *
 * `__session` / `__refresh` stay host-only so an orphan CNAME session is
 * not replayed on the next OAuth attempt.
 */
export function rewriteClerkProxySetCookie(
  raw: string,
  appHost: string,
): string | null {
  const name = clerkCookieName(raw);
  const domainMatch = raw.match(/;\s*Domain=([^;]*)/i);
  const app = appHost.toLowerCase().replace(/^\./, "");
  const appApex = app.replace(/^www\./, "");

  if (isClerkClientTokenCookieName(name)) {
    return withCookieDomain(raw, appApex);
  }

  if (isClerkAuthCookieName(name)) {
    return withCookieDomain(raw, null);
  }

  if (!domainMatch) return raw;
  const cookieDomain = domainMatch[1].trim().replace(/^\./, "").toLowerCase();

  if (isClerkOwnedHostname(cookieDomain)) {
    // Cloudflare bot cookies minted for Clerk's CNAME — not used by clerk-js.
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

/**
 * After GitHub, oauth_callback runs on clerk.anima-protocol.com and may set
 * `__session` on `.anima-protocol.com` while a CNAME-host `__client` stays
 * there. The SPA then calls `/api/__clerk` with that orphan session cookie.
 * Clerk returns authorization_invalid on handshake. Handshake tokens are
 * single-use and must not share the request with a mismatched pair.
 * Proxied oauth_callback keeps `__client` (see stripClerkAuthCookies).
 */
export function stripClerkAuthCookies(
  cookieHeader: string,
  options: { keepClientToken?: boolean } = {},
): string {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const name = part.split("=", 1)[0] || "";
      if (options.keepClientToken && isClerkClientTokenCookieName(name)) {
        return true;
      }
      return !isClerkAuthCookieName(name);
    })
    .join("; ");
}

export function isClerkHandshakeRequest(requestUrl: string | undefined): boolean {
  if (!requestUrl) return false;
  try {
    const url = new URL(requestUrl, "https://anima-protocol.com");
    const path = (url.pathname || "/").split("?")[0] || "/";
    if (path === "/v1/client/handshake" || path.startsWith("/v1/client/handshake/")) {
      return true;
    }
    return (
      url.searchParams.has("__clerk_handshake") ||
      url.searchParams.has("__clerk_handshake_nonce")
    );
  } catch {
    return /__clerk_handshake/.test(requestUrl);
  }
}

/** Document Referer after GitHub → Clerk CNAME → SPA `/sign-in/sso-callback`. */
export function isClerkSsoCallbackReferer(referer: string | undefined): boolean {
  if (!referer) return false;
  try {
    const path = new URL(referer).pathname.replace(/\/+$/, "") || "/";
    return path === "/sign-in/sso-callback" || path === "/sign-up/sso-callback";
  } catch {
    return /\/sign-(?:in|up)\/sso-callback(?:\/|\?|#|$)/.test(referer);
  }
}

/** GitHub (and Google) finish on `/v1/oauth_callback` — document, not XHR. */
export function isClerkOAuthCallbackPath(
  requestUrl: string | undefined,
): boolean {
  if (!requestUrl) return false;
  try {
    const path =
      new URL(requestUrl, "https://anima-protocol.com").pathname.split("?")[0] ||
      "/";
    return path === "/v1/oauth_callback" || path.startsWith("/v1/oauth_callback/");
  } catch {
    return /\/v1\/oauth_callback(?:\/|\?|#|$)/.test(requestUrl);
  }
}

/**
 * Proxied oauth_callback without a real `code`+`state` always 301/403s
 * `authorization_invalid` JSON from Clerk (live, even with no cookies).
 * Do not forward that to clerk-js — send the browser to `/sign-in`.
 */
export function clerkOAuthCallbackShouldBypassUpstream(
  requestUrl: string | undefined,
): boolean {
  if (!requestUrl || !isClerkOAuthCallbackPath(requestUrl)) return false;
  try {
    const url = new URL(requestUrl, "https://anima-protocol.com");
    if (url.searchParams.get("err_code")) return true;
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    return !code || !state;
  } catch {
    return true;
  }
}

/** SPA landing for a failed proxied oauth_callback (never the 403 JSON body). */
export function clerkOAuthCallbackSignInRedirect(
  origin: string | undefined,
  errCode = "authorization_invalid",
): string {
  const base = origin || "https://anima-protocol.com";
  return `${base}/sign-in?clerk_error=${encodeURIComponent(errCode)}`;
}

/**
 * Live Clerk 403 on `/v1/oauth_callback?err_code=` is the user JSON
 * `{ code: "authorization_invalid", clerk_trace_id }`. Do not give that
 * body to clerk-js even when the request had `code`+`state`.
 */
export function clerkOAuthCallbackShouldHideUpstreamBody(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Handshake JWT (query/path) or a proxied oauth_callback.
 * Do **not** strip on ordinary `/v1/client` just because Referer is
 * `/sign-in/sso-callback`. After a successful CNAME hop, clerk-js refetches
 * `/v1/client` with that Referer; stripping drops the `__session` handshake
 * just minted and HandleSSOCallback navigates to signed-out `/sign-in`.
 * Orphan CNAME `__session` on `/v1/client` is 200 (not authorization_invalid).
 * oauth_callback still forwards `__client` after the strip.
 */
export function shouldStripClerkAuthCookies(
  requestUrl: string | undefined,
  _referer?: string,
): boolean {
  return (
    isClerkHandshakeRequest(requestUrl) || isClerkOAuthCallbackPath(requestUrl)
  );
}

/**
 * Names only — never values. Used to expire leaked Domain=apex copies and
 * for secret-free oauth_callback diagnostics.
 */
export function collectClerkAuthCookieNames(
  cookieHeader: string | undefined,
): string[] {
  if (!cookieHeader) return [];
  const names = new Set<string>();
  for (const part of cookieHeader.split(";")) {
    const name = clerkCookieName(part);
    if (isClerkAuthCookieName(name)) names.add(name);
  }
  return [...names];
}

export function expireApexClerkAuthCookie(
  name: string,
  appApex: string,
): string {
  const apex = appApex.toLowerCase().replace(/^\./, "").replace(/^www\./, "");
  return `${name}=; Path=/; Domain=${apex}; Max-Age=0; Secure; SameSite=Lax`;
}

export function apexClerkAuthCookieExpiries(
  names: Iterable<string>,
  appApex: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    // Session cookies must stay host-only across refresh. Domain=apex
    // Max-Age=0 for `__client` / `__session` on the apex host is what
    // made login look signed-out after reload (#406 over-expire).
    if (!isClerkClientUatCookieName(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(expireApexClerkAuthCookie(name, appApex));
  }
  return out;
}

/**
 * Send Clerk-Secret-Key on Worker→CNAME /v1/* so environment/client work.
 * Never on /npm/* (jsDelivr) or /v1/oauth_callback — Secret-Key on the
 * callback makes Clerk return authorization_invalid even with no cookies
 * (live: proxied callback 301 err_code; CNAME callback 303 failed).
 */
export function shouldAuthorizeClerkUpstream(
  requestUrl: string | undefined,
): boolean {
  if (!requestUrl) return true;
  try {
    const path =
      new URL(requestUrl, "https://anima-protocol.com").pathname.split("?")[0] ||
      "/";
    if (isClerkNpmAssetPath(path)) return false;
    if (isClerkOAuthCallbackPath(requestUrl)) return false;
    return true;
  } catch {
    return !isClerkNpmAssetPath(requestUrl) && !isClerkOAuthCallbackPath(requestUrl);
  }
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
 *
 * `/v1/oauth_callback?err_code=` must NOT stay on `/api/__clerk`. Live GET
 * of that proxy path returns the user-visible 403 JSON
 * `{ code: "authorization_invalid", clerk_trace_id }`. clerk-js with
 * `proxyUrl` + `redirect: follow` surfaces that as an XHR body.
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
      if (isClerkOAuthCallbackPath(`${url.pathname}${url.search}`)) {
        const err = url.searchParams.get("err_code");
        // Only failed hops go to /sign-in. A Location with code+state is a
        // real callback (first-party proxy or Clerk multi-hop) — keep it on
        // /api/__clerk so #417 does not steal a legitimate document navigation.
        if (err) {
          return `${opts.appOrigin}/sign-in?clerk_error=${encodeURIComponent(err)}`;
        }
        return `${opts.appOrigin}${proxyPath}${url.pathname}${url.search}${url.hash}`;
      }
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

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || "";
}

/**
 * End-user IP for Clerk FAPI. Behind Cloudflare the leftmost X-Forwarded-For
 * hop is attacker-controlled; Clerk docs require CF-Connecting-IP instead.
 */
export function clientIpFromHeaders(headers: IncomingHttpHeaders): string {
  return (
    firstHeaderValue(headers["cf-connecting-ip"]) ||
    firstHeaderValue(headers["true-client-ip"]) ||
    firstHeaderValue(headers["x-real-ip"]) ||
    firstHeaderValue(headers["x-forwarded-for"]) ||
    ""
  );
}

export type ClerkUpstreamHeaderOptions = {
  /**
   * Official path-proxy protocol (frontend-api.clerk.dev + dashboard Proxy URL).
   * Must stay false for CNAME FAPI (clerk.anima-protocol.com): Clerk-Proxy-Url
   * and X-Forwarded-Host make /v1/client return host_invalid on a CNAME-only
   * instance.
   */
  officialProxy?: boolean;
  /**
   * Send Clerk-Secret-Key so Worker-originated /v1/* calls are authorized.
   * Defaults to officialProxy. Never enable for /npm/* hops — those 307 to
   * jsDelivr and must not receive the secret.
   */
  authorizeUpstream?: boolean;
  /** Upstream path+query — used to detect OAuth handshake consumption. */
  requestUrl?: string;
};

export function buildClerkUpstreamHeaders(
  req: { headers: IncomingHttpHeaders; method?: string },
  secretKey: string,
  options: ClerkUpstreamHeaderOptions = {},
): Headers {
  const officialProxy = options.officialProxy !== false;
  const authorizeUpstream = options.authorizeUpstream ?? officialProxy;
  const { proxyUrl, origin, host } = buildClerkProxyHeaderValues(req, secretKey);
  const protocol = forwardedRequestProto(req.headers);
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

  // Browser FAPI uses Origin + cookies. Forwarding Authorization together
  // with Origin makes Clerk return origin_authorization_headers_conflict.
  headers.delete("Authorization");

  if (officialProxy) {
    headers.set("Clerk-Proxy-Url", proxyUrl);
    if (host) {
      headers.set("X-Forwarded-Host", host);
      headers.set("X-Forwarded-Proto", protocol);
    }
  }
  if (authorizeUpstream && secretKey) {
    headers.set("Clerk-Secret-Key", secretKey.trim());
  }
  if (origin) {
    headers.set("Origin", origin);
  }

  const clientIp = clientIpFromHeaders(req.headers);
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
  }

  const refererHeader = req.headers.referer;
  const referer = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;
  if (shouldStripClerkAuthCookies(options.requestUrl, referer)) {
    const cookie = headers.get("cookie");
    if (cookie) {
      const stripped = stripClerkAuthCookies(cookie, {
        // Proxied oauth_callback still needs ProductionBrowser `__client`.
        // Strip leftover UAT / orphan session — those 301 authorization_invalid
        // even when `__client` is present (live CNAME matrix).
        keepClientToken: isClerkOAuthCallbackPath(options.requestUrl),
      });
      if (stripped) headers.set("cookie", stripped);
      else headers.delete("cookie");
    }
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
  rewrite: {
    appHost: string;
    appOrigin: string;
    fapiHost: string;
    requestCookie?: string;
    requestUrl?: string;
    referer?: string;
  },
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

  const rewritten: string[] = [];
  for (const cookie of collectSetCookies(upstream)) {
    const next = rewriteClerkProxySetCookie(cookie, rewrite.appHost);
    if (!next) continue;
    rewritten.push(next);
  }

  // Never Domain=apex-expire Clerk cookies from the Worker. On
  // anima-protocol.com, `Domain=apex; Max-Age=0` also deletes the host-only
  // cookie of the same name (Chrome/Safari). Live
  // `HEAD /api/__clerk/v1/oauth_callback` still sent
  // `__client_uat=; Domain=anima-protocol.com; Max-Age=0` because #414's
  // skip-when-minting does not apply when Clerk does not mint (HEAD 405).
  // Leftover CNAME Domain=apex UAT is expired in the SPA (#415).
  for (const cookie of rewritten) {
    appendSetCookie(res, cookie);
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
  const authorizeUpstream = shouldAuthorizeClerkUpstream(upstreamPath);
  const headers = buildClerkUpstreamHeaders(req, secretKey, {
    officialProxy,
    authorizeUpstream,
    requestUrl: upstreamPath,
  });
  const npmHeaders = authorizeUpstream
    ? buildClerkUpstreamHeaders(req, secretKey, {
        officialProxy: false,
        authorizeUpstream: false,
      })
    : headers;
  const body = await readRequestBody(req);
  const method = req.method?.toUpperCase() || "GET";
  const payloadBody = body ? new Uint8Array(body) : undefined;

  if (isClerkOAuthCallbackPath(upstreamPath)) {
    const cookieHeader = headers.get("cookie") || "";
    logger.info(
      {
        path: upstreamPath.split("?")[0],
        authorizeUpstream,
        secretKeySent: headers.has("Clerk-Secret-Key"),
        clerkCookieNames: collectClerkAuthCookieNames(cookieHeader),
        bypassUpstream: clerkOAuthCallbackShouldBypassUpstream(upstreamPath),
      },
      "Clerk oauth_callback proxy",
    );
    if (clerkOAuthCallbackShouldBypassUpstream(upstreamPath)) {
      res.statusCode = 303;
      res.setHeader("location", clerkOAuthCallbackSignInRedirect(origin));
      res.end();
      return;
    }
  }

  let upstream = await fetchImpl(upstreamUrl, {
    method,
    headers,
    body: payloadBody,
    redirect: "manual",
    signal: upstreamAbortSignal(),
  });

  // Clerk serves `/npm/@clerk/clerk-js@6/...` as 307 → `@6.31.0`. Script tags
  // (and our connectivity probe) need 200 JS, not a Location hop.
  // Follow-up hops go to jsDelivr / Clerk CDN — never send Clerk-Secret-Key.
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
      headers: npmHeaders,
      redirect: "manual",
      signal: upstreamAbortSignal(),
    });
  }

  if (
    isClerkOAuthCallbackPath(upstreamPath) &&
    clerkOAuthCallbackShouldHideUpstreamBody(upstream.status)
  ) {
    await upstream.arrayBuffer().catch(() => undefined);
    res.statusCode = 303;
    res.setHeader("location", clerkOAuthCallbackSignInRedirect(origin));
    res.end();
    return;
  }

  res.statusCode = upstream.status;
  const requestCookie = req.headers.cookie;
  const refererHeader = req.headers.referer;
  forwardClerkProxyResponseHeaders(upstream, res, {
    appHost: host,
    appOrigin: origin,
    fapiHost,
    requestCookie: Array.isArray(requestCookie) ? requestCookie[0] : requestCookie,
    requestUrl: upstreamPath,
    referer: Array.isArray(refererHeader) ? refererHeader[0] : refererHeader,
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
