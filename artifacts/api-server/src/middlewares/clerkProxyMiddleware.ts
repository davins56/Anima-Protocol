/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. There is no external Clerk
 * dashboard — all auth configuration is done through the Auth pane.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import {
  isDevelopmentFromPublishableKey,
  publishableKeyFromHost,
} from "@clerk/shared/keys";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";
import type { IncomingHttpHeaders } from "http";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

/** Public hosts that mint Clerk sessions for this product (apex + www). */
export const KNOWN_PUBLIC_HOSTS = new Set([
  "www.anima-protocol.com",
  "anima-protocol.com",
  "anima-protocol.replit.app",
]);

/**
 * Returns the first effective public hostname for the given request,
 * preferring x-forwarded-host over the Host header so callers behind a
 * proxy see the original client-facing host.
 *
 * x-forwarded-host can take three shapes:
 *   - undefined (no proxy involved)
 *   - a single string (one proxy hop)
 *   - a comma-delimited string when an upstream appended rather than
 *     replaced the header (Node folds duplicate headers this way), or a
 *     string[] in some Express typings
 * In the multi-value case, the leftmost value is the original client-
 * facing host. Take that one in all forms. Exported so that app.ts
 * (clerkMiddleware callback) and this proxy middleware agree on which
 * hostname is canonical — otherwise multi-domain/custom-domain flows
 * break.
 */
function hostFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || undefined;
}

function normalizeHostname(host: string | undefined): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

function isLocalDevHost(hostname: string): boolean {
  if (!hostname) return true;
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.0.0.1")
  );
}

function isBackendProxyHost(hostname: string): boolean {
  return (
    hostname.endsWith(".replit.app") ||
    hostname.endsWith(".replit.dev") ||
    hostname.endsWith(".repl.co")
  );
}

/**
 * Pick the Clerk publishable key for JWT verification.
 *
 * Development (`pk_test_`): the browser skips the Clerk proxy on custom domains
 * (see App.full.jsx) and talks to the dev Clerk instance directly, so tokens
 * must be verified with the same dev publishable key from env — not
 * publishableKeyFromHost(clerk.{hostname}).
 *
 * Production (`pk_live_`): sessions on custom domains are minted via the
 * /api/__clerk proxy, so verification uses the host-derived publishable key.
 */
export function resolveClerkPublishableKey(
  host: string | undefined,
  fallbackKey: string | undefined,
): string {
  const hostname = normalizeHostname(host);
  if (fallbackKey && isDevelopmentFromPublishableKey(fallbackKey)) {
    return fallbackKey;
  }
  return publishableKeyFromHost(hostname, fallbackKey);
}

export function getClerkProxyHost(req: {
  headers: IncomingHttpHeaders;
}): string | undefined {
  const originHost = hostFromUrl(
    typeof req.headers.origin === "string" ? req.headers.origin : undefined,
  );
  const refererHost = hostFromUrl(
    typeof req.headers.referer === "string" ? req.headers.referer : undefined,
  );

  const forwarded = headerValue(req.headers["x-forwarded-host"]);
  if (forwarded && !isBackendProxyHost(normalizeHostname(forwarded))) {
    return forwarded;
  }
  if (forwarded && !originHost && !refererHost) {
    return forwarded;
  }

  // Browser (or Vercel edge proxy) sends this on store calls so Vercel → Replit
  // proxies still resolve the public custom domain when upstream strips Origin.
  const publicHost = headerValue(req.headers["x-anima-public-host"]);
  if (publicHost) {
    const normalized = normalizeHostname(publicHost);
    if (KNOWN_PUBLIC_HOSTS.has(normalized)) {
      return publicHost;
    }
    if (
      normalized === normalizeHostname(originHost) ||
      normalized === normalizeHostname(refererHost)
    ) {
      return publicHost;
    }
  }

  // Vercel → Replit rewrites sometimes arrive with only the backend Host while
  // the browser Origin still reflects the public custom domain. Clerk JWT
  // verification must use that public host to pick the right publishable key.
  if (originHost) return originHost;
  if (refererHost) return refererHost;
  if (forwarded) return forwarded;

  const hostHeader = headerValue(req.headers.host);
  if (hostHeader && !isBackendProxyHost(normalizeHostname(hostHeader))) {
    return hostHeader;
  }

  return hostHeader;
}

/** Hostnames to try when verifying a Clerk JWT (www/apex + known production). */
export function getClerkAuthHostCandidates(req: {
  headers: IncomingHttpHeaders;
}): string[] {
  const hosts = new Set<string>();
  const primary = getClerkProxyHost(req);
  if (primary) hosts.add(normalizeHostname(primary));
  for (const known of KNOWN_PUBLIC_HOSTS) hosts.add(known);
  for (const h of [...hosts]) {
    if (h.startsWith("www.")) hosts.add(h.slice(4));
    else if (h.includes(".") && !isLocalDevHost(h)) hosts.add(`www.${h}`);
  }
  return [...hosts].filter(Boolean);
}

export function clerkProxyMiddleware(): RequestHandler {
  // Only run proxy in production — Clerk proxying doesn't work for dev instances
  if (process.env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  return createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = getClerkProxyHost(req) || "";
        const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}`;

        proxyReq.setHeader("Clerk-Proxy-Url", proxyUrl);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);

        // Clerk validates that Origin matches the proxy URL's host. When the
        // browser hits a backend on a different host (e.g. Vercel → Replit),
        // rewrite Origin to the public proxy origin so POST /client succeeds.
        if (host) {
          proxyReq.setHeader("Origin", `${protocol}://${host}`);
        }

        const xff = req.headers["x-forwarded-for"];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "";
        if (clientIp) {
          proxyReq.setHeader("X-Forwarded-For", clientIp);
        }
      },
    },
  }) as RequestHandler;
}
