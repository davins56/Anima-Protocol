import pino from "pino";

// pino-pretty spawns a worker transport that crashes Vercel serverless cold
// starts when NODE_ENV is unset or "development". Only enable pretty logs for
// local long-running dev — never on Vercel/Lambda.
const usePrettyTransport =
  process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(usePrettyTransport
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
