import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import "./lib/loadEnv";
import "./lib/ensureClerkPreviewRedirects";
import cors from "cors";
import pinoHttp from "pino-http";
import healthRouter from "./routes/health";
import router from "./routes";
import clerkWebhookRouter from './webhooks/clerk'
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { clerkMiddleware } from "@clerk/express";


const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk Frontend API proxy — must be mounted before body parsers because it
// streams raw request bytes. Only active in production.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
// Limit raised to accommodate base64 image data URLs (e.g. avatar AI edit,
// which posts the source image inline). The image-edit route enforces its own
// 20MB byte cap on the decoded buffer.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health checks must remain public so platform probes can distinguish service
// availability from auth configuration problems.
app.use("/api", healthRouter);

// Verify Clerk JWTs before hitting any protected routes.
// This populates req.auth for @clerk/express helpers.
app.use(clerkMiddleware());

app.use('/api/webhooks', clerkWebhookRouter);

// All other API routes are protected.

app.use("/api", router);


/    // Error handling middleware
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      logger.error({ err }, "Unhandled API error");
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : "Internal server error";
        const isConfig = message.includes("DATABASE_URL") || message.includes("connection");
        res.status(isConfig ? 503 : 500).json({
          error: isConfig
            ? "API is misconfigured on the server. Check environment variables."
            : "Internal server error",
        });
      }
    });

    // ✅ Correct Clerk setup
    app.use(clerkMiddleware());

    export default app;
  // After creating the app and other middleware...

// ✅ Correct Clerk setup for @clerk/express v2+
import (requireAuth) from '@clerk/express'

// Apply Clerk middleware early (before routes)
app.use(clerkMiddleware())

// ... your other routes and middleware ...

export default app
