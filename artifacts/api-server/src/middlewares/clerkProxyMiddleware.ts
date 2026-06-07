/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * IMPORTANT:
 * - Must be mounted BEFORE express.json() middleware
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import type { RequestHandler } from "express";
import { handleClerkProxyRequest } from "./clerkProxyFetch";

export {
  CLERK_PROXY_PATH,
  KNOWN_PUBLIC_HOSTS,
  canonicalClerkProxyHeaderHost,
  getClerkAuthHostCandidates,
  getClerkProxyHost,
  resolveClerkPublishableKey,
} from "./clerkProxyHosts";

function clerkProxyEnabled(): boolean {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim() || "";
  if (process.env.NODE_ENV === "production") return true;
  return publishableKey.startsWith("pk_live_");
}

export function clerkProxyMiddleware(): RequestHandler {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!clerkProxyEnabled() || !secretKey) {
    return (_req, res) => {
      res.status(503).json({
        error: "clerk_proxy_unavailable",
        message:
          "Clerk proxy is not configured. Set CLERK_SECRET_KEY (and CLERK_PUBLISHABLE_KEY) on the server.",
      });
    };
  }

  if (!secretKey.startsWith("sk_")) {
    return (_req, res) => {
      res.status(503).json({
        error: "clerk_proxy_invalid_secret",
        message:
          "CLERK_SECRET_KEY must be a secret key (sk_live_… or sk_test_…), not a publishable key.",
      });
    };
  }

  // fetch-based proxy — http-proxy-middleware returns 504 on Vercel serverless
  // when upstream Clerk is reachable via fetch but not via node-http-proxy.
  return (req, res) => {
    void handleClerkProxyRequest(req, res, secretKey);
  };
}
