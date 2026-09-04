// Load local environment variables before any imports that read process.env.
import "dotenv/config";

import path from "node:path";
import fs from "node:fs";
import app from "./app";
import { ensureClerkPreviewRedirects } from "./lib/ensureClerkPreviewRedirects";
import { logger } from "./lib/logger";

// If the repo is run from a different CWD, dotenv/config may not find the
// package-local or repository-root .env file. Load the first existing file.
import dotenv from "dotenv";
const envCandidates = [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
];
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) dotenv.config({ path: envPath });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

// Fail-fast so misconfiguration is obvious.
requireEnv("DATABASE_URL");
requireEnv("CLERK_SECRET_KEY");

// Register this preview deployment's Clerk callback URLs on cold start. Vercel
// preview hosts are unique per deployment, and Clerk does not allow wildcard
// redirect URLs.
void ensureClerkPreviewRedirects();

// CLERK_WEBHOOK_SECRET is only consumed by the optional /api/webhooks/clerk svix
// verification route. It is NOT provisioned in this project's environments
// (development or production) and the app functions without it, so requiring it
// at boot would needlessly crash the server — which in production fails the
// deploy startup probe (/api/healthz) and blocks publishing. Warn if absent; the
// webhook route degrades gracefully (returns 503) when the secret is missing.
if (!process.env.CLERK_WEBHOOK_SECRET?.trim()) {
  logger.warn(
    "CLERK_WEBHOOK_SECRET is not set; the Clerk webhook route (/api/webhooks/clerk) will return 503. This is expected unless Clerk webhooks have been configured.",
  );
}

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
