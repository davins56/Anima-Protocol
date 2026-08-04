import type { Request, Response, NextFunction } from "express";

const windowMs = 60_000;
const maxRequests = 30;

const counts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const entry = counts.get(ip);

  if (!entry || now > entry.resetAt) {
    counts.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return;
  }

  next();
}
import { getAuth } from "@clerk/express";

const DEFAULT_WINDOW_MS = 60_000;
// Authenticated chat/store traffic easily exceeds the old shared 30/min IP
// budget once Vercel collapses clients onto one proxy address.
const DEFAULT_MAX_REQUESTS = 120;

type Counter = { count: number; resetAt: number };

const counts = new Map<string, Counter>();

export type RateLimitOptions = {
  /** Max requests per window (default 120). */
  max?: number;
  /** Window length in ms (default 60s). */
  windowMs?: number;
  /** Optional bucket prefix so different route groups don't share counters. */
  name?: string;
};

/** Test helper — clears in-memory counters between cases. */
export function resetRateLimitStateForTests(): void {
  counts.clear();
}

/**
 * Best-effort client identity for rate limiting.
 * Prefer the signed-in Clerk user so serverless/proxy IP collapse cannot
 * lock every visitor behind one shared bucket.
 */
export function rateLimitKey(req: Request, name = "default"): string {
  try {
    const { userId } = getAuth(req);
    if (userId) return `${name}:user:${userId}`;
  } catch {
    // getAuth throws when Clerk middleware did not run; fall through to IP.
  }

  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  const ip = (req.ip || realIp || forwarded || req.socket.remoteAddress || "unknown")
    // Some proxies append :port — strip so the same client keeps one bucket.
    .replace(/:\d+$/, "");
  return `${name}:ip:${ip || "unknown"}`;
}

export function createRateLimit(options: RateLimitOptions = {}) {
  const max = options.max ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const name = options.name ?? "default";

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = rateLimitKey(req, name);
    const now = Date.now();
    const entry = counts.get(key);

    if (!entry || now > entry.resetAt) {
      counts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: `Too many requests. Please slow down and retry in about ${retryAfterSec}s.`,
        code: "rate_limit",
        retry_after_seconds: retryAfterSec,
      });
      return;
    }

    next();
  };
}

/** Default limiter used by chat / openai / storage / TTS routers. */
export const rateLimit = createRateLimit();
