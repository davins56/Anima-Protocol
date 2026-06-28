import { createClerkClient } from "@clerk/express";
import { createClerkRequest } from "@clerk/backend/internal";
import type { RequestHandler, Request } from "express";
import {
  getClerkAuthHostCandidates,
  getClerkProxyHost,
  resolveClerkPublishableKey,
} from "./clerkProxyMiddleware";

/** Minimal signed-out auth so @clerk/express getAuth() never throws. */
function attachSignedOutAuth(req: Request): void {
  Object.assign(req, {
    auth: () => ({
      userId: null,
      sessionId: null,
      sessionClaims: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
      orgPermissions: null,
      factorVerificationAge: null,
      getToken: async () => null,
      has: () => false,
      debug: () => ({}),
    }),
  });
}

function expressToWebRequest(req: Request): globalThis.Request {
  const host = getClerkProxyHost(req) || req.headers.host || "localhost";
  const protocol =
    (typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"].split(",")[0]?.trim()
      : undefined) || "https";
  const url = new URL(
    req.originalUrl || req.url || "/",
    `${protocol}://${host}`,
  );
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return new globalThis.Request(url.toString(), { method: req.method, headers });
}

/**
 * Clerk JWT verification for Vercel custom domains proxied to Replit. Tries
 * publishable keys for www/apex and other known hosts until one accepts the token.
 */
export function clerkMultiDomainMiddleware(): RequestHandler {
  const secretKey = process.env.CLERK_SECRET_KEY || "";
  const client = createClerkClient({ secretKey });
  const fallbackKey = process.env.CLERK_PUBLISHABLE_KEY;

  return async (req, res, next) => {
    if ("auth" in req && typeof req.auth === "function") {
      return next();
    }

    const clerkReq = createClerkRequest(expressToWebRequest(req));
    const candidates = getClerkAuthHostCandidates(req);

    for (const host of candidates) {
      try {
        const publishableKey = resolveClerkPublishableKey(host, fallbackKey);
        const state = await client.authenticateRequest(clerkReq, {
          secretKey,
          publishableKey,
        });
        const auth = state.toAuth();
        if (auth?.userId) {
          Object.assign(req, {
            auth: (opts?: Parameters<typeof state.toAuth>[0]) =>
              state.toAuth(opts),
          });
          return next();
        }
      } catch {
        // Wrong publishable key for this host — try the next candidate.
      }
    }

    // Signed-out: still attach auth() so getAuth() works.
    try {
      const host = getClerkProxyHost(req) || candidates[0] || "";
      const state = await client.authenticateRequest(clerkReq, {
        secretKey,
        publishableKey: resolveClerkPublishableKey(host, fallbackKey),
      });
      Object.assign(req, {
        auth: (opts?: Parameters<typeof state.toAuth>[0]) => state.toAuth(opts),
      });
    } catch {
      // Clerk misconfigured or token invalid — treat as signed-out, not crash.
    }
    if (!("auth" in req)) {
      attachSignedOutAuth(req);
    }
    next();
  };
}
