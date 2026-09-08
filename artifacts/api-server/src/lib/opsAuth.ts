import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Bearer or x-admin-migration-secret token from an operator request. */
export function readOpsBearerToken(req: Request): string {
  const header = req.header("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return req.header("x-admin-migration-secret")?.trim() ?? "";
}

/**
 * Operator secrets already used for admin DDL / cron.
 * Health is mounted before Clerk, so session auth is not available here.
 */
export function configuredOpsSecrets(): string[] {
  return [process.env.ADMIN_MIGRATION_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
}

export function matchesOpsBearer(req: Request): boolean {
  const token = readOpsBearerToken(req);
  if (!token) return false;
  return configuredOpsSecrets().some((secret) => timingSafeEqualString(token, secret));
}

/**
 * Gate unauthenticated operator POST routes (health schema ensure).
 * GET inspect stays public; POST runs DDL.
 */
export function requireOpsBearer(
  req: Request,
  res: Response,
  next: () => void,
): void {
  const secrets = configuredOpsSecrets();
  if (!secrets.length) {
    res.status(503).json({
      error:
        "Schema ensure is locked. Set ADMIN_MIGRATION_SECRET or CRON_SECRET on the server.",
      code: "ops_secret_unconfigured",
    });
    return;
  }
  if (!matchesOpsBearer(req)) {
    res.status(401).json({ error: "Unauthorized", code: "ops_unauthorized" });
    return;
  }
  next();
}
