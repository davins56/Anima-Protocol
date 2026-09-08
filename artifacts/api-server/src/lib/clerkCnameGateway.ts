import {
  ANIMA_APEX_HOST,
  CLERK_PROXY_PATH,
} from "../middlewares/clerkProxyHosts";
import { readRuntimeEnv } from "./cloudflareEnv";
import {
  CLERK_FAPI,
  buildClerkUpstreamHeaders,
  clerkCookieName,
  clerkOAuthCallbackShouldBypassUpstream,
  clerkOAuthCallbackShouldHideUpstreamBody,
  clerkOAuthCallbackSignInRedirect,
  collectClerkAuthCookieNames,
  isClerkClientTokenCookieName,
  isClerkClientUatCookieName,
  isClerkOAuthCallbackPath,
  resolveClerkUpstreamUrl,
  rewriteClerkProxyLocation,
  rewriteClerkProxySetCookie,
  shouldAuthorizeClerkUpstream,
  stripClerkAuthCookies,
} from "../middlewares/clerkProxyFetch";
import {
  CLERK_CNAME_HOST,
  clerkFrontendFetchInit,
  isClerkCnameRequestHost,
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

/** Shared FAPI — clerk.{apex} is this Worker now; resolveOverride 522s. */
export function clerkCnameUpstreamUrl(requestUrl: string): URL {
  const url = new URL(requestUrl);
  return resolveClerkUpstreamUrl(`${url.pathname}${url.search}`, CLERK_FAPI);
}

export async function fetchClerkCnameUpstream(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const requestUrl = `${url.pathname}${url.search}`;
  let cookie = request.headers.get("cookie") || "";
  if (isClerkOAuthCallbackPath(request.url)) {
    cookie = await cookieHeaderForClerkCnameOAuth(request);
  }
  const secretKey = readRuntimeEnv("CLERK_SECRET_KEY") || "";
  const headers = buildClerkUpstreamHeaders(
    {
      method: request.method,
      headers: {
        host: ANIMA_APEX_HOST,
        origin: clerkCnameAppOrigin(),
        cookie: cookie || undefined,
        accept: request.headers.get("accept") || undefined,
        "user-agent": request.headers.get("user-agent") || undefined,
        "cf-connecting-ip": request.headers.get("cf-connecting-ip") || undefined,
      },
    },
    secretKey,
    {
      officialProxy: true,
      authorizeUpstream: shouldAuthorizeClerkUpstream(requestUrl),
      requestUrl,
    },
  );
  const method = request.method.toUpperCase();
  const upstreamUrl = clerkCnameUpstreamUrl(request.url);
  return fetchImpl(
    upstreamUrl,
    clerkFrontendFetchInit(upstreamUrl, {
      method,
      headers,
      redirect: "manual",
      body:
        method === "GET" || method === "HEAD" ? undefined : request.body,
    }),
  );
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
