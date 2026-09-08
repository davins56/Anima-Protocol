import {
  ANIMA_APEX_HOST,
  CLERK_PROXY_PATH,
} from "../middlewares/clerkProxyHosts";
import {
  clerkCookieName,
  clerkOAuthCallbackShouldBypassUpstream,
  clerkOAuthCallbackShouldHideUpstreamBody,
  clerkOAuthCallbackSignInRedirect,
  collectClerkAuthCookieNames,
  isClerkClientTokenCookieName,
  isClerkClientUatCookieName,
  isClerkNpmAssetPath,
  isClerkOAuthCallbackPath,
  rewriteClerkProxyLocation,
  rewriteClerkProxySetCookie,
  shouldAuthorizeClerkUpstream,
  stripClerkAuthCookies,
} from "../middlewares/clerkProxyFetch";
import { readRuntimeEnv } from "./cloudflareEnv";
import {
  CLERK_CNAME_HOST,
  clerkCnameUpstreamUrl,
  clerkFrontendFetchInit,
  isClerkCnameRequestHost,
  stripClerkCnameHostHeader,
} from "./clerkFrontendFetch";
import { recallGitHubOAuthClientState } from "./clerkOAuthStateStore";

export { CLERK_CNAME_HOST, isClerkCnameRequestHost };

const DROP_UPSTREAM_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-security-policy",
]);

export function clerkCnameAppOrigin(): string {
  return `https://${ANIMA_APEX_HOST}`;
}

export function collectSetCookieValues(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie();
    if (cookies.length > 0) return cookies;
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

/**
 * CNAME oauth_callback plants `__client_uat=0; Domain=apex` on every miss.
 * That leftover 301s the *next* GitHub hop even when `__client` is present.
 */
export function shouldForwardClerkCnameSetCookie(raw: string): boolean {
  const name = clerkCookieName(raw);
  if (isClerkClientUatCookieName(name)) return false;
  const rewritten = rewriteClerkProxySetCookie(raw, ANIMA_APEX_HOST);
  return Boolean(rewritten);
}

export function rewriteClerkCnameSetCookie(raw: string): string | null {
  if (!shouldForwardClerkCnameSetCookie(raw)) return null;
  return rewriteClerkProxySetCookie(raw, ANIMA_APEX_HOST);
}

export function rewriteClerkCnameLocation(location: string): string {
  return rewriteClerkProxyLocation(location, {
    fapiHost: CLERK_CNAME_HOST,
    appOrigin: clerkCnameAppOrigin(),
    proxyPath: CLERK_PROXY_PATH,
  });
}

/**
 * Safari ITP CNAME-cloaking omits Domain=apex `__client` on GitHub →
 * clerk.{apex}. If we stashed the token when `/v1/client/sign_ins`
 * minted the authorize URL, inject it so Clerk still sees ProductionBrowser.
 */
export async function cookieHeaderForClerkCnameOAuth(
  request: Request,
): Promise<string> {
  const incoming = request.headers.get("cookie") || "";
  const stripped = stripClerkAuthCookies(incoming, { keepClientToken: true });
  const names = collectClerkAuthCookieNames(stripped);
  if (names.some((name) => isClerkClientTokenCookieName(name))) {
    return stripped;
  }
  let state: string | null = null;
  try {
    state = new URL(request.url).searchParams.get("state");
  } catch {
    state = null;
  }
  if (!state) return stripped;
  const token = await recallGitHubOAuthClientState(state);
  if (!token) return stripped;
  const injected = `__client=${token}`;
  return stripped ? `${stripped}; ${injected}` : injected;
}

/**
 * Official path-proxy headers for frontend-api.clerk.dev. Host stays the
 * rewritten clerk.dev name (never clerk.{apex} — that 403s). Proxy URL is
 * always the apex /api/__clerk path, not the CNAME host.
 */
export function applyClerkOwnedFapiGatewayHeaders(
  headers: Headers,
  request: Request,
): void {
  stripClerkCnameHostHeader(headers);
  headers.set("Clerk-Proxy-Url", `${clerkCnameAppOrigin()}${CLERK_PROXY_PATH}/`);
  headers.set("Origin", clerkCnameAppOrigin());
  headers.set("X-Forwarded-Host", ANIMA_APEX_HOST);
  headers.set("X-Forwarded-Proto", "https");
  const clientIp =
    headers.get("cf-connecting-ip") ||
    request.headers.get("cf-connecting-ip") ||
    headers.get("true-client-ip") ||
    request.headers.get("true-client-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  if (clientIp) headers.set("X-Forwarded-For", clientIp);

  const path = `${new URL(request.url).pathname}${new URL(request.url).search}`;
  const secret = (readRuntimeEnv("CLERK_SECRET_KEY") || "").trim();
  const authorize =
    secret &&
    !isClerkNpmAssetPath(new URL(request.url).pathname) &&
    (shouldAuthorizeClerkUpstream(path) ||
      (isClerkOAuthCallbackPath(path) &&
        !clerkOAuthCallbackShouldBypassUpstream(path)));
  if (authorize) headers.set("Clerk-Secret-Key", secret);
  else headers.delete("Clerk-Secret-Key");
}

export async function fetchClerkCnameUpstream(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const headers = new Headers(request.headers);
  if (isClerkOAuthCallbackPath(request.url)) {
    const cookie = await cookieHeaderForClerkCnameOAuth(request);
    if (cookie) headers.set("cookie", cookie);
    else headers.delete("cookie");
  }
  applyClerkOwnedFapiGatewayHeaders(headers, request);
  const upstreamUrl = clerkCnameUpstreamUrl(request.url);
  const method = request.method.toUpperCase();
  const init: RequestInit = clerkFrontendFetchInit(upstreamUrl, {
    method,
    headers,
    redirect: "manual",
  });
  if (method !== "GET" && method !== "HEAD" && request.body) {
    init.body = request.body;
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }
  return fetchImpl(upstreamUrl, init);
}

export function clerkCnameFailedOAuthRedirect(errCode?: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: clerkOAuthCallbackSignInRedirect(clerkCnameAppOrigin(), errCode),
      "cache-control": "no-store",
    },
  });
}

export function applyClerkCnameResponseHeaders(
  upstream: Response,
  headers: Headers,
): void {
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (DROP_UPSTREAM_HEADERS.has(lower)) return;
    if (lower === "set-cookie") return;
    if (lower === "location") {
      headers.set(name, rewriteClerkCnameLocation(value));
      return;
    }
    headers.set(name, value);
  });
  for (const cookie of collectSetCookieValues(upstream)) {
    const next = rewriteClerkCnameSetCookie(cookie);
    if (next) headers.append("set-cookie", next);
  }
}

/**
 * Terminate GitHub's top-level hop on our Worker (same eTLD+1 as the SPA)
 * instead of Clerk's CNAME-cloaked 403 JSON document.
 */
export async function handleClerkCnameGateway(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const requestUrl = `${url.pathname}${url.search}`;

  if (
    isClerkOAuthCallbackPath(requestUrl) &&
    clerkOAuthCallbackShouldBypassUpstream(requestUrl)
  ) {
    return clerkCnameFailedOAuthRedirect();
  }

  const upstream = await fetchClerkCnameUpstream(request, fetchImpl);

  if (
    isClerkOAuthCallbackPath(requestUrl) &&
    clerkOAuthCallbackShouldHideUpstreamBody(upstream.status)
  ) {
    await upstream.arrayBuffer().catch(() => undefined);
    return clerkCnameFailedOAuthRedirect();
  }

  const headers = new Headers();
  applyClerkCnameResponseHeaders(upstream, headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
