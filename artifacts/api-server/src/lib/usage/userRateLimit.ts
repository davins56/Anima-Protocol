/**
 * Durable per-user rate limits for the paid AI endpoints (security audit
 * 2026-11-14 H1). The old `createRateLimit` keeps an in-memory Map per Worker
 * isolate, so every new isolate starts a fresh budget.
 *
 * Production uses the `USER_RATE_LIMITER` Durable Object (wrangler.jsonc),
 * one object per Clerk user. Node, vitest, and a Worker without the binding
 * (or a DO call that throws) use an in-process book: correct for one process,
 * per-isolate on Workers, i.e. no worse than before.
 *
 * Limits are env-tunable: ANIMA_RL_<SCOPE>_PER_MIN / ANIMA_RL_<SCOPE>_PER_DAY.
 */

import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { readRuntimeBinding, readRuntimeEnv } from "../cloudflareEnv";
import { logger } from "../logger";
import {
  applyHit,
  applyRefund,
  normalizeBook,
  type HitResult,
  type LimitRule,
  type LimiterBook,
} from "./limiterState";

export type UsageScope = "chat_proxy" | "invoke" | "photo" | "voice";

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

/** Defaults sized for a person, not a script. Tune with env. */
export const SCOPE_DEFAULTS: Record<UsageScope, { perMin: number; perDay: number }> = {
  chat_proxy: { perMin: 60, perDay: 2000 },
  invoke: { perMin: 180, perDay: 5000 },
  photo: { perMin: 6, perDay: 150 },
  voice: { perMin: 30, perDay: 600 },
};

function envInt(name: string, fallback: number, env: Record<string, string | undefined>): number {
  const raw = env[name] ?? readRuntimeEnv(name);
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : fallback;
}

export function scopeRules(
  scope: UsageScope,
  env: Record<string, string | undefined> = process.env,
): LimitRule[] {
  const d = SCOPE_DEFAULTS[scope];
  const upper = scope.toUpperCase();
  return [
    { name: `${scope}:min`, max: envInt(`ANIMA_RL_${upper}_PER_MIN`, d.perMin, env), windowMs: MINUTE_MS },
    { name: `${scope}:day`, max: envInt(`ANIMA_RL_${upper}_PER_DAY`, d.perDay, env), windowMs: DAY_MS },
  ];
}

export type UserLimiter = {
  hit(userId: string, rules: LimitRule[], cost: number): Promise<HitResult>;
  refund(userId: string, rules: LimitRule[], cost: number): Promise<void>;
};

type LimiterStub = {
  hit(rules: LimitRule[], cost: number): Promise<HitResult>;
  refund(rules: LimitRule[], cost: number): Promise<void>;
};
type LimiterNamespace = { getByName(name: string): LimiterStub };

export function createMemoryUserLimiter(now: () => number = Date.now): UserLimiter {
  const books = new Map<string, LimiterBook>();
  const book = (userId: string) => {
    let b = books.get(userId);
    if (!b) {
      b = normalizeBook(null);
      books.set(userId, b);
    }
    return b;
  };
  return {
    async hit(userId, rules, cost) {
      return applyHit(book(userId), rules, cost, now());
    },
    async refund(userId, rules, cost) {
      applyRefund(book(userId), rules, cost, now());
    },
  };
}

function readNamespace(): LimiterNamespace | null {
  const value = readRuntimeBinding("USER_RATE_LIMITER");
  if (!value || typeof value !== "object") return null;
  if (typeof (value as { getByName?: unknown }).getByName !== "function") return null;
  return value as LimiterNamespace;
}

let memoryLimiter: UserLimiter | undefined;
let testLimiter: UserLimiter | undefined;
let warnedFallback = false;

function memory(): UserLimiter {
  if (!memoryLimiter) memoryLimiter = createMemoryUserLimiter();
  return memoryLimiter;
}

function warnFallback(err?: unknown): void {
  if (warnedFallback) return;
  warnedFallback = true;
  logger.warn(
    { err },
    "USER_RATE_LIMITER Durable Object unavailable; per-user limits are per isolate until it is bound",
  );
}

export function getUserLimiter(): UserLimiter {
  if (testLimiter) return testLimiter;
  const ns = readNamespace();
  if (!ns) return memory();
  const stub = (userId: string) => ns.getByName(`u:${userId}`);
  return {
    async hit(userId, rules, cost) {
      try {
        return await stub(userId).hit(rules, cost);
      } catch (err) {
        warnFallback(err);
        return memory().hit(userId, rules, cost);
      }
    },
    async refund(userId, rules, cost) {
      try {
        await stub(userId).refund(rules, cost);
      } catch (err) {
        warnFallback(err);
        await memory().refund(userId, rules, cost);
      }
    },
  };
}

export function setUserLimiterForTests(limiter: UserLimiter | undefined): void {
  testLimiter = limiter;
}

export function resetUserLimiterForTests(): void {
  testLimiter = undefined;
  memoryLimiter = undefined;
  warnedFallback = false;
}

export function sendRateLimited(res: Response, retryAfterMs: number, scope: string): void {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json({
    error: `Too many requests. Please slow down and retry in about ${retryAfterSec}s.`,
    code: "rate_limit",
    scope,
    retry_after_seconds: retryAfterSec,
  });
}

/** Count one request against the user's scope; respond 429 when over. */
export async function checkUserLimit(
  userId: string,
  scope: UsageScope,
  cost = 1,
): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
  const result = await getUserLimiter().hit(userId, scopeRules(scope), cost);
  return result.allowed ? { allowed: true } : { allowed: false, retryAfterMs: result.retryAfterMs };
}

/**
 * Express middleware. Signed-out requests pass through: every route behind it
 * already answers 401 without a Clerk user.
 */
export function userRateLimit(scope: UsageScope, cost: (req: Request) => number = () => 1) {
  return async function durableUserRateLimit(req: Request, res: Response, next: NextFunction) {
    let userId: string | null | undefined;
    try {
      userId = getAuth(req).userId;
    } catch {
      userId = null;
    }
    if (!userId) return next();
    try {
      const verdict = await checkUserLimit(userId, scope, cost(req));
      if (!verdict.allowed) {
        sendRateLimited(res, verdict.retryAfterMs, scope);
        return;
      }
    } catch (err) {
      // The fallback already swallowed DO errors; anything here is a bug in
      // the limiter itself. Fail open: the per-isolate limiter still runs.
      logger.warn({ err, scope }, "user rate limit check failed");
    }
    next();
  };
}
