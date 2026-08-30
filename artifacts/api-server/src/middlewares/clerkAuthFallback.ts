import type { Request, RequestHandler, Response, NextFunction } from "express";
import { clerkMiddleware } from "@clerk/express";
import { logger } from "../lib/logger";
import { SERVER_MISCONFIGURED_MESSAGE } from "../lib/configErrors";
import { resolveRuntimePublishableKey } from "./clerkProxyHosts";

/**
 * Brand attached to `req.auth` by @clerk/express. Presence of a plain `auth`
 * function is not enough — getAuth() requires this Symbol.for brand.
 * See @clerk/express dist/utils (clerkAuthBrand).
 */
const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

type SignedOutAuth = {
  userId: null;
  sessionId: null;
  sessionClaims: null;
  orgId: null;
  orgRole: null;
  orgSlug: null;
  orgPermissions: null;
  factorVerificationAge: null;
  getToken: () => Promise<null>;
  has: () => false;
  debug: () => Record<string, never>;
};

function makeSignedOutAuth(): SignedOutAuth {
  return {
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
  };
}

/** Attach branded signed-out auth so getAuth(req) returns userId: null. */
export function attachSignedOutAuth(req: Request): void {
  const authHandler = Object.assign(() => makeSignedOutAuth(), {
    [CLERK_AUTH_BRAND]: true as const,
  });
  Object.assign(req, { auth: authHandler });
}

export function isClerkConfigError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    /Publishable key/i.test(message) ||
    /CLERK_PUBLISHABLE_KEY/i.test(message) ||
    /CLERK_SECRET_KEY/i.test(message) ||
    /secret key/i.test(message) ||
    /publishable key is missing/i.test(message)
  );
}

/**
 * Wraps clerkMiddleware so a bad/missing CLERK_PUBLISHABLE_KEY (or other Clerk
 * boot-time failures) cannot turn every /api/store request into a 500.
 *
 * - Invalid/missing publishable key → derive from host (anima custom domain)
 * - Remaining config errors → 503 with a clear misconfiguration message
 * - Other auth failures → signed-out auth; route guards return 401
 */
export function safeClerkMiddleware(): RequestHandler {
  const inner = clerkMiddleware((req) => {
    const publishableKey = resolveRuntimePublishableKey(req);
    const secretKey = process.env.CLERK_SECRET_KEY?.trim();
    return {
      ...(publishableKey ? { publishableKey } : {}),
      ...(secretKey ? { secretKey } : {}),
    };
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const continueAsSignedOut = (err: unknown) => {
      if (isClerkConfigError(err)) {
        logger.error(
          { err },
          "Clerk auth is misconfigured (check CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY)",
        );
        if (!res.headersSent) {
          res.status(503).json({
            error: SERVER_MISCONFIGURED_MESSAGE,
          });
        }
        return;
      }

      logger.warn(
        { err },
        "Clerk middleware failed; treating request as signed-out",
      );
      attachSignedOutAuth(req);
      next();
    };

    try {
      // clerkMiddleware is async and reports failures via next(err).
      inner(req, res, (err?: unknown) => {
        if (err != null) {
          continueAsSignedOut(err);
          return;
        }
        next();
      });
    } catch (err) {
      continueAsSignedOut(err);
    }
  };
}
