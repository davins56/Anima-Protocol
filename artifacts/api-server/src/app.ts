import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";

import { runWithDbRequestScope } from "@workspace/db";

import { syncCloudflareRuntimeEnvMiddleware } from "./lib/cloudflareEnv";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { safeClerkMiddleware } from "./middlewares/clerkAuthFallback";
import clerkWebhookRouter from "./webhooks/clerk";
import healthRouter from "./routes/health";
import router from "./routes";
import { logger } from "./lib/logger";
import { classifyDbError } from "./lib/dbErrors";
import { isStoreApiPath } from "./lib/workerApiGuard";
import {
  isUnhandledConfigError,
  SERVER_MISCONFIGURED_MESSAGE,
} from "./lib/configErrors";

const app: Express = express();

// Vercel (and most hosts) terminate TLS in front of the function. Without this,
// req.ip is the proxy hop and every visitor shares one rate-limit bucket —
// which surfaces as "Too many requests" after a single chat send.
app.set("trust proxy", 1);

// Re-apply Worker secrets onto process.env on every request. cloudflare:node
// may snapshot or reset process.env after fetch() mirroring; Clerk/DB readers
// then see empty keys and 503 "API is misconfigured".
app.use(syncCloudflareRuntimeEnvMiddleware());

// Open a new database request scope. Cloudflare Workers bind every socket to
// the request context that created it, so a Postgres client cached at module
// scope cannot be reused — or closed — by a later request. Without this, the
// second request on a warm isolate fails with "Cannot perform I/O on behalf of
// a different request" (or hangs until the 20s Worker timeout), which the UI
// reports as "the database could not be reached". Must run before any route
// that touches the database, including /api/healthz/db.
app.use((_req, _res, next) => {
  runWithDbRequestScope(next);
});

// Clerk Frontend API proxy — must be mounted before the body parsers because it
// streams raw request bytes. It self-guards and is only active in production /
// pk_live; otherwise it returns a deterministic 503. Keys are read per request.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Webhook route needs the raw request body for svix signature verification, so
// it must be mounted before the JSON body parser.
app.use("/api/webhooks", clerkWebhookRouter);

app.use(cors({ credentials: true, origin: true }));
// Limit raised to accommodate base64 image data URLs (e.g. avatar AI edit,
// which posts the source image inline). Individual routes enforce their own
// byte caps on the decoded buffer.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health checks must remain public so platform startup probes (/api/healthz)
// can distinguish service availability from auth configuration problems.
app.use("/api", healthRouter);
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Verify Clerk JWTs before hitting any protected routes; populates req.auth for
// the @clerk/express helpers used downstream. Wrapped so a bad/missing
// CLERK_PUBLISHABLE_KEY cannot 500 every character/store request.
app.use(safeClerkMiddleware());

// Application API routes (store, chat, openai, storage, admin, character image,
// battle models, elevenlabs, placeholder image).
app.use("/api", router);

// Global error handler — prevents an unhandled error from wedging the process.
app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled API error");
    if (!res.headersSent) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      const dbInfo = classifyDbError(err);
      const isConfig = isUnhandledConfigError(message);
      const store = isStoreApiPath(req.path || req.originalUrl || "");
      // Dead Hyperdrive / isolate throws on /api/store must be JSON 503 so
      // the Character library can show the bundled roster — never HTML 1101.
      if (dbInfo.isDbError || store) {
        res.status(503).json({
          error: dbInfo.isDbError
            ? dbInfo.safeMessage
            : "The companion store is temporarily unavailable.",
          // Report the real verdict. Previously a non-database failure on a
          // store path was sent as reason 'unavailable' -- a DbErrorReason --
          // so the UI told users the database was down whenever any store
          // route threw. dbError is the explicit signal clients read; reason
          // stays for older clients and is now honest ('internal' when the
          // database was not involved).
          dbError: dbInfo.isDbError,
          reason: dbInfo.reason,
          code: dbInfo.code ?? (store ? "store_unavailable" : "database_unavailable"),
        });
        return;
      }
      res.status(isConfig ? 503 : 500).json({
        error: isConfig ? SERVER_MISCONFIGURED_MESSAGE : "Internal server error",
      });
    }
  },
);

export default app;