/**
 * Metering for the paid AI endpoints (security audit 2026-11-14 H1).
 *
 * Order for every photo / voice call, all BEFORE the provider is called:
 *   1. durable per-user burst limit (429 + Retry-After),
 *   2. a free daily allowance (durable counter, resets 00:00 UTC),
 *   3. otherwise consumeEntitlement() spends purchased credits (402 when
 *      there are none).
 * If the provider then fails, refundUsage() gives the unit back (free
 * counter decremented, or an append-only 'refund' ledger row).
 *
 * Text chat stays free. Kill switch: ANIMA_METERING=off. Exempt (e.g. the
 * steward): ANIMA_METERING_EXEMPT_USER_IDS. The idempotency key is always
 * generated here, never taken from the client (a client key would let a
 * replayed request reuse one paid use for free).
 */

import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { readRuntimeEnv } from "../cloudflareEnv";
import { logger } from "../logger";
import {
  DAY_MS,
  getUserLimiter,
  scopeRules,
  sendRateLimited,
  type UserLimiter,
} from "../usage/userRateLimit";
import { windowStartFor, type LimitRule } from "../usage/limiterState";
import {
  InsufficientEntitlementError,
  consumeEntitlement,
  entitlementBalances,
  refundEntitlement,
  type Balances,
} from "./ledger";

export type MeterKind = "photo" | "voice";
type Entitlement = "photo_credits" | "voice_minutes";

const ENTITLEMENT: Record<MeterKind, Entitlement> = {
  photo: "photo_credits",
  voice: "voice_minutes",
};

const FREE_DEFAULTS: Record<MeterKind, { env: string; value: number }> = {
  photo: { env: "ANIMA_FREE_PHOTOS_PER_DAY", value: 10 },
  voice: { env: "ANIMA_FREE_VOICE_UNITS_PER_DAY", value: 20 },
};

type Env = Record<string, string | undefined>;

function read(name: string, env?: Env): string | undefined {
  return env ? env[name] : process.env[name] ?? readRuntimeEnv(name);
}

export function meteringEnabled(env?: Env): boolean {
  const raw = String(read("ANIMA_METERING", env) ?? "").trim().toLowerCase();
  return !["off", "false", "0", "no"].includes(raw);
}

export function isMeteringExempt(userId: string, env?: Env): boolean {
  return String(read("ANIMA_METERING_EXEMPT_USER_IDS", env) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

export function freeAllowance(kind: MeterKind, env?: Env): number {
  const { env: name, value } = FREE_DEFAULTS[kind];
  const raw = read(name, env);
  if (raw === undefined || String(raw).trim() === "") return value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : value;
}

export function freeRule(kind: MeterKind, env?: Env): LimitRule {
  return { name: `free_${kind}:day`, max: freeAllowance(kind, env), windowMs: DAY_MS };
}

export type Charge = {
  userId: string;
  kind: MeterKind;
  units: number;
  source: "exempt" | "free" | "ledger";
  key: string | null;
  refunded: boolean;
};

export type MeterDenied = {
  status: 402 | 429 | 503;
  retryAfterMs?: number;
  body: Record<string, unknown>;
};

export type MeterDeps = {
  limiter?: UserLimiter;
  consume?: typeof consumeEntitlement;
  refund?: typeof refundEntitlement;
  balances?: (userId: string) => Promise<Balances>;
  env?: Env;
  now?: () => number;
};

function isMissingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

export async function chargeUsage(
  input: { userId: string; kind: MeterKind; units?: number },
  deps: MeterDeps = {},
): Promise<{ ok: true; charge: Charge } | { ok: false; denied: MeterDenied }> {
  const limiter = deps.limiter ?? getUserLimiter();
  const units = Math.max(1, Math.floor(input.units ?? 1));
  const base = { userId: input.userId, kind: input.kind, units, refunded: false };

  // 1. Burst / daily cap, one per request regardless of units.
  const burst = await limiter.hit(input.userId, scopeRules(input.kind, deps.env), 1);
  if (!burst.allowed) {
    return {
      ok: false,
      denied: {
        status: 429,
        retryAfterMs: burst.retryAfterMs,
        body: { code: "rate_limit", scope: input.kind },
      },
    };
  }

  if (!meteringEnabled(deps.env) || isMeteringExempt(input.userId, deps.env)) {
    return { ok: true, charge: { ...base, source: "exempt", key: null } };
  }

  // 2. Free daily allowance.
  const free = await limiter.hit(input.userId, [freeRule(input.kind, deps.env)], units);
  if (free.allowed) return { ok: true, charge: { ...base, source: "free", key: null } };

  // 3. Purchased credits, spent before the provider call.
  const entitlement = ENTITLEMENT[input.kind];
  const key = randomUUID();
  const now = (deps.now ?? Date.now)();
  const resetsAt = new Date(windowStartFor(now, DAY_MS) + DAY_MS).toISOString();
  try {
    await (deps.consume ?? consumeEntitlement)({ userId: input.userId, entitlement, units, idempotencyKey: key });
    return { ok: true, charge: { ...base, source: "ledger", key } };
  } catch (err) {
    if (err instanceof InsufficientEntitlementError || (err as { code?: string })?.code === "insufficient_entitlement" || isMissingTable(err)) {
      return {
        ok: false,
        denied: {
          status: 402,
          body: {
            error:
              input.kind === "photo"
                ? "You have used today's free photos and have no photo credits left."
                : "You have used today's free voice and have no voice minutes left.",
            code: "insufficient_entitlement",
            entitlement,
            units,
            free_per_day: freeAllowance(input.kind, deps.env),
            free_resets_at: resetsAt,
          },
        },
      };
    }
    logger.warn({ err, kind: input.kind }, "metering: consumeEntitlement failed");
    return {
      ok: false,
      denied: {
        status: 503,
        body: {
          error: "Usage metering is unavailable right now. Please try again shortly.",
          code: "metering_unavailable",
        },
      },
    };
  }
}

/** Give the unit back after a provider failure. Safe to call twice. */
export async function refundUsage(charge: Charge | null | undefined, deps: MeterDeps = {}): Promise<void> {
  if (!charge || charge.refunded || charge.source === "exempt") return;
  charge.refunded = true;
  try {
    if (charge.source === "free") {
      await (deps.limiter ?? getUserLimiter()).refund(charge.userId, [freeRule(charge.kind, deps.env)], charge.units);
      return;
    }
    if (charge.key) {
      await (deps.refund ?? refundEntitlement)({
        userId: charge.userId,
        entitlement: ENTITLEMENT[charge.kind],
        units: charge.units,
        idempotencyKey: charge.key,
      });
    }
  } catch (err) {
    logger.warn({ err, kind: charge.kind, source: charge.source }, "metering: refund failed");
  }
}

export function sendMeterDenied(res: Response, denied: MeterDenied): void {
  if (denied.status === 429) {
    sendRateLimited(res, denied.retryAfterMs ?? 60_000, String(denied.body.scope || "usage"));
    return;
  }
  res.status(denied.status).json(denied.body);
}

/** Refund when the route answers with an error status. */
export function refundOnErrorResponse(res: Response, charge: Charge, deps: MeterDeps = {}): void {
  res.once("finish", () => {
    if (res.statusCode >= 400) void refundUsage(charge, deps);
  });
}

/**
 * Deep mode on the generic chat proxy needs an active deep-mode pass. Without
 * one (or when the ledger can't be read) the request runs in normal mode.
 */
export async function deepModeAllowed(userId: string, deps: MeterDeps = {}): Promise<boolean> {
  if (!meteringEnabled(deps.env) || isMeteringExempt(userId, deps.env)) return true;
  try {
    const balances = await (deps.balances ?? ((id: string) => entitlementBalances(id)))(userId);
    return Boolean(balances.deep_mode_active_until);
  } catch (err) {
    if (!isMissingTable(err)) logger.warn({ err }, "metering: deep mode balance read failed");
    return false;
  }
}

/** Rough ElevenLabs cost: about 900 characters of text per voice unit (~1 minute). */
export function ttsUnitsForText(text: string): number {
  return Math.max(1, Math.ceil(String(text || "").length / 900));
}
