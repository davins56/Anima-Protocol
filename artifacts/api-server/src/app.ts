import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import "./lib/loadEnv";
import cors from "cors";
import pinoHttp from "pino-http";
import healthRouter from "./routes/health";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { clerkMultiDomainMiddleware } from "./middlewares/clerkMultiDomainMiddleware";

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

// Verify Clerk JWTs against www/apex and other known hosts (Vercel → Replit).
app.use(clerkMultiDomainMiddleware());

app.use("/api", router);

// Prevent unhandled errors from wedging the Vercel function instance.
app.use(
  (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    logger.error({ err }, "Unhandled API error");
    if (!res.headersSent) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      const isConfig =
        message.includes("DATABASE_URL") || message.includes("CLERK_SECRET_KEY");
      res.status(isConfig ? 503 : 500).json({
        error: isConfig
          ? "API is misconfigured on the server. Check Vercel environment variables."
          : "Internal server error",
      });
    }
  },
);

export default app;
