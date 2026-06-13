// Load local environment variables (artifacts/api-server/.env) before any imports that read process.env.
import "dotenv/config";

import path from "node:path";
import app from "./app";
import { logger } from "./lib/logger";

// If the repo is run from a different CWD, dotenv/config may not find artifacts/api-server/.env.
// Explicitly load it as a fallback.
import dotenv from "dotenv";
const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

// Fail-fast so misconfiguration is obvious.
requireEnv("DATABASE_URL");
requireEnv("CLERK_WEBHOOK_SECRET");
requireEnv("CLERK_SECRET_KEY");

const rawPort = process.env.API_PORT ?? process.env.PORT;


if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
