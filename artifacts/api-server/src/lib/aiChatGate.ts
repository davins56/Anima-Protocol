import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/** Per-IP cap for the public-looking chat probe. Small on purpose. */
export const AI_CHAT_RATE_LIMIT_MAX = 8;
export const AI_CHAT_RATE_LIMIT_WINDOW_MS = 60_000;

const PRODUCTION_RUNTIMES = new Set([
  "worker",
  "cloudflare",
  "cloudflare-workers",
  "vercel",
  "serverless",
  "edge",
  "cloudrun",
  "cloud-run",
  "gcp",
]);

function envFlag(value: string | undefined): boolean | null {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return null;
}

/**
 * Production chat probe must not be an open relay onto the one Ollama slot.
 * Local Node (`ANIMA_RUNTIME=node`) stays open so health checks and tests
 * can still reach a loopback model. `/api/healthz/llm` is a different route.
 */
export function aiChatRequiresCredential(env: NodeJS.ProcessEnv = process.env): boolean {
  const forced = envFlag(env.ANIMA_AI_CHAT_REQUIRE_AUTH);
  if (forced != null) return forced;
  const runtime = (env.ANIMA_RUNTIME || "").trim().toLowerCase();
  if (PRODUCTION_RUNTIMES.has(runtime)) return true;
  return env.NODE_ENV === "production" && env.VITEST !== "true";
}

export function readBearerToken(req: Request): string {
  const header = req.header("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export function aiChatProbeAuthorized(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const key = (env.ANIMA_AI_CHAT_PROBE_KEY || "").trim();
  const token = readBearerToken(req);
  if (!key || !token || key.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(token));
}

/** A credential that might be a Clerk session, distinct from the probe key. */
export function aiChatHasSessionCredential(req: Request): boolean {
  if (readBearerToken(req)) return true;
  const cookie = req.header("cookie") ?? "";
  return /(?:^|;\s*)__(?:session|client|clerk)/i.test(cookie);
}
