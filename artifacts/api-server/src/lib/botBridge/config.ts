/**
 * Anima ↔ Grok Bot bridge: runtime configuration.
 *
 * Design: /workspace/audits/anima-bot-bridge-proposal.md (Revision 2, approved
 * as a plan). Every reader here fails closed: an unset, malformed or
 * out-of-range value falls back to the safe default, never to "unlimited".
 *
 * Secrets: each bot's HMAC signing secret is a Worker secret named
 * `ANIMA_BRIDGE_SECRET_<BOT_ID>` (bot id upper-cased, `-` → `_`). It is read
 * through `readRuntimeEnv` only, never logged, never returned by any API and
 * never a `VITE_` variable.
 */
import { readRuntimeEnv } from "../cloudflareEnv";

/** Feature flag. Off unless explicitly `on` / `true` / `1`. */
export const BOT_BRIDGE_FLAG = "ANIMA_BOT_BRIDGE";
export const BOT_BRIDGE_SECRET_PREFIX = "ANIMA_BRIDGE_SECRET_";
/** Shortest secret accepted. Anything shorter counts as not configured. */
export const BOT_BRIDGE_MIN_SECRET_LENGTH = 32;
/** Signature timestamp window, seconds either side of now (plan §4). */
export const BOT_BRIDGE_MAX_SKEW_SECONDS = 5 * 60;
/** Hard ceilings: env can lower these, never raise them. */
export const BOT_BRIDGE_MESSAGE_MAX_BYTES_CEILING = 4096;
export const BOT_BRIDGE_STATUS_MAX_BYTES_CEILING = 8192;

/** Bot ids: lowercase slug, 2–48 chars, e.g. `chief-of-staff`. */
export const BOT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$/;

type Env = (name: string) => string | undefined;
const defaultEnv: Env = (name) => readRuntimeEnv(name);

export function isBotBridgeFlagOn(env: Env = defaultEnv): boolean {
  const raw = (env(BOT_BRIDGE_FLAG) ?? "").trim().toLowerCase();
  return raw === "on" || raw === "true" || raw === "1";
}

export function isValidBotId(botId: unknown): botId is string {
  return typeof botId === "string" && BOT_ID_PATTERN.test(botId);
}

/** `chief-of-staff` → `ANIMA_BRIDGE_SECRET_CHIEF_OF_STAFF`. */
export function botSecretEnvName(botId: string): string {
  if (!isValidBotId(botId)) throw new Error("invalid bot id");
  return `${BOT_BRIDGE_SECRET_PREFIX}${botId.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * The bot's signing secret, or null when it is missing, too short or the id is
 * malformed. Callers must treat null as "unknown bot" (fail closed).
 */
export function readBotSecret(botId: string, env: Env = defaultEnv): string | null {
  if (!isValidBotId(botId)) return null;
  const value = env(botSecretEnvName(botId))?.trim() ?? "";
  if (value.length < BOT_BRIDGE_MIN_SECRET_LENGTH) return null;
  return value;
}

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env(name)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) return fallback;
  return n;
}

export type BotBridgeLimits = {
  /** Inbound requests per bot per minute (default 30). */
  inboundPerMinutePerBot: number;
  /** Inbound requests per user per day, all bots together (default 200). */
  inboundPerDayPerUser: number;
  /** Outbound drafts per companion per day (default 20; tool_permissions.daily_limit range 0..500). */
  outboundPerDayPerCompanion: number;
  /** Raw body cap for POST /message (default and ceiling 4096 bytes). */
  messageMaxBytes: number;
  /** Raw body cap for POST /status (default and ceiling 8192 bytes). */
  statusMaxBytes: number;
  /** A status row older than this is shown as stale, never as current (default 6 h). */
  statusTtlHours: number;
  /** Pending anima→bot confirmations expire after this (default 24 h). */
  confirmTtlHours: number;
};

/** Env-tunable limits (plan §5 item 8). Out-of-range values use the default. */
export function readBotBridgeLimits(env: Env = defaultEnv): BotBridgeLimits {
  return {
    inboundPerMinutePerBot: readInt(env, "ANIMA_BRIDGE_INBOUND_PER_MINUTE", 30, 1, 120),
    inboundPerDayPerUser: readInt(env, "ANIMA_BRIDGE_INBOUND_DAILY_LIMIT", 200, 1, 2000),
    outboundPerDayPerCompanion: readInt(env, "ANIMA_BRIDGE_OUTBOUND_DAILY_LIMIT", 20, 0, 500),
    messageMaxBytes: readInt(
      env,
      "ANIMA_BRIDGE_MESSAGE_MAX_BYTES",
      BOT_BRIDGE_MESSAGE_MAX_BYTES_CEILING,
      256,
      BOT_BRIDGE_MESSAGE_MAX_BYTES_CEILING,
    ),
    statusMaxBytes: readInt(
      env,
      "ANIMA_BRIDGE_STATUS_MAX_BYTES",
      BOT_BRIDGE_STATUS_MAX_BYTES_CEILING,
      512,
      BOT_BRIDGE_STATUS_MAX_BYTES_CEILING,
    ),
    statusTtlHours: readInt(env, "ANIMA_BRIDGE_STATUS_TTL_HOURS", 6, 1, 24),
    confirmTtlHours: readInt(env, "ANIMA_BRIDGE_CONFIRM_TTL_HOURS", 24, 1, 72),
  };
}

/**
 * Bots allowed to publish status for *other* bots (the digest sender, e.g.
 * Chief Of Staff). Comma list of bot ids. Everyone else may only report on
 * itself. Default: nobody.
 */
export function readStatusPublishers(env: Env = defaultEnv): Set<string> {
  const raw = env("ANIMA_BRIDGE_STATUS_PUBLISHERS") ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(isValidBotId),
  );
}
