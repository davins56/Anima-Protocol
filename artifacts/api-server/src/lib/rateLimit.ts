import type { Request, Response, NextFunction } from "express";
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
  /** "ip" does not collapse a signed-in user into one bucket. Default prefers the user. */
  identity?: "user" | "ip";
};

/**
 * Drop a trailing port from IPv4:port or [IPv6]:port.
 * A plain IPv6 address contains colons; stripping `:\d+$` would collapse
 * `2001:db8::1234` into `2001:db8:` and merge unrelated clients.
 */
export function stripIpPort(ip: string): string {
  const value = String(ip || "").trim();
  if (!value) return "";
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return bracketed[1] || value;
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4WithPort) return v4WithPort[1] || value;
  return value;
}

/**
 * Best-effort client IP. On Cloudflare Workers `CF-Connecting-IP` is set by
 * the edge and cannot be spoofed by the caller, so it wins; elsewhere fall back
 * to Express `req.ip` (trust proxy), then the forwarding headers.
 */
export function clientIp(req: Request): string {
  const cfIp = String(req.headers?.["cf-connecting-ip"] || "").trim();
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  const realIp = String(req.headers?.["x-real-ip"] || "").trim();
  const ip = stripIpPort(
    cfIp || req.ip || realIp || forwarded || req.socket?.remoteAddress || "unknown",
  );
  return ip || "unknown";
}

/** Test helper — clears in-memory counters between cases. */
export function resetRateLimitStateForTests(): void {
  counts.clear();
  lastSweepAt = 0;
}

/**
 * Drop expired buckets so a long-lived isolate does not keep one entry per
 * visitor forever. Runs at most once per sweep interval and only when the map
 * has grown, so the hot path stays O(1).
 */
const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_MIN_ENTRIES = 1_000;
let lastSweepAt = 0;

export function sweepExpiredRateLimits(now = Date.now()): void {
  if (counts.size < SWEEP_MIN_ENTRIES || now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, entry] of counts) {
    if (now > entry.resetAt) counts.delete(key);
  }
}

/** Test helper — current number of tracked buckets. */
export function rateLimitBucketCountForTests(): number {
  return counts.size;
}

/**
 * Best-effort client identity for rate limiting.
 * Prefer the signed-in Clerk user so serverless/proxy IP collapse cannot
 * lock every visitor behind one shared bucket.
 */
export function rateLimitKey(
  req: Request,
  name = "default",
  identity: "user" | "ip" = "user",
): string {
  if (identity !== "ip") {
    try {
      const { userId } = getAuth(req);
      if (userId) return `${name}:user:${userId}`;
    } catch {
      // getAuth throws when Clerk middleware did not run; fall through to IP.
    }
  }

  return `${name}:ip:${clientIp(req)}`;
}

export function createRateLimit(options: RateLimitOptions = {}) {
  const max = options.max ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const name = options.name ?? "default";
  const identity = options.identity ?? "user";

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = rateLimitKey(req, name, identity);
    const now = Date.now();
    sweepExpiredRateLimits(now);
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
