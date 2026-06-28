import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import clerkWebhookRouter from "./webhooks/clerk";
import healthRouter from "./routes/health";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Clerk Frontend API proxy — must be mounted before the body parsers because it
// streams raw request bytes. It self-guards and is only active in production /
// pk_live; otherwise it returns a deterministic 503.
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
// the @clerk/express helpers used downstream.
app.use(clerkMiddleware());

// Application API routes (store, chat, openai, storage, admin, character image,
// elevenlabs, placeholder image).
app.use("/api", router);

// Global error handler — prevents an unhandled error from wedging the process.
app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled API error");
    if (!res.headersSent) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      const isConfig =
        message.includes("DATABASE_URL") ||
        message.includes("CLERK_SECRET_KEY") ||
        message.includes("connection");
      res.status(isConfig ? 503 : 500).json({
        error: isConfig
          ? "API is misconfigured on the server. Check environment variables."
          : "Internal server error",
      });
    }
  },
);

export default app;
