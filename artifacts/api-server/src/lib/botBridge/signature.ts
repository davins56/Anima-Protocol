/**
 * Inbound bot→anima request authentication (plan §4).
 *
 *   X-Anima-Bridge-Bot: <bot_id>
 *   X-Anima-Bridge-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>
 *
 * Verified on the raw request bytes before any JSON parsing. The comparison is
 * constant-time (`timingSafeEqualString`). Failures return a reason code for
 * logs and tests only; the HTTP response never says which check failed, and
 * nothing here ever logs or returns the secret.
 */
import { createHmac } from "node:crypto";
import { timingSafeEqualString } from "../opsAuth";
import { BOT_BRIDGE_MAX_SKEW_SECONDS, isValidBotId } from "./config";

export const BOT_HEADER = "x-anima-bridge-bot";
export const SIGNATURE_HEADER = "x-anima-bridge-signature";

export type BridgeAuthFailure =
  | "missing_headers"
  | "bad_bot_id"
  | "unknown_bot"
  | "bad_signature_format"
  | "stale_timestamp"
  | "bad_signature"
  | "too_large";

export type BridgeAuthResult =
  | { ok: true; botId: string; timestamp: number; signature: string }
  | { ok: false; reason: BridgeAuthFailure };

export function signBridgePayload(secret: string, timestamp: number, rawBody: string | Buffer): string {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** Header value a bot sends; used by tests and by the Grok Bot routine docs. */
export function bridgeSignatureHeader(secret: string, timestamp: number, rawBody: string | Buffer): string {
  return `t=${timestamp},v1=${signBridgePayload(secret, timestamp, rawBody)}`;
}

export function parseSignatureHeader(
  header: string | undefined | null,
): { timestamp: number; signatures: string[] } | null {
  if (!header || header.length > 512) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (timestamp !== null || !/^\d{1,12}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/.test(value)) return null;
      if (signatures.length < 3) signatures.push(value);
    }
    // Unknown schemes are ignored so a later v2 can be added without breaking v1.
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export type VerifyInput = {
  botIdHeader: string | undefined | null;
  signatureHeader: string | undefined | null;
  rawBody: Buffer;
  maxBytes: number;
  /** Secret lookup; must return null for unknown / unconfigured bots. */
  secretFor: (botId: string) => string | null;
  nowMs?: number;
};

export function verifyBridgeRequest(input: VerifyInput): BridgeAuthResult {
  const { botIdHeader, signatureHeader, rawBody, maxBytes, secretFor } = input;
  const nowMs = input.nowMs ?? Date.now();
  if (rawBody.length > maxBytes) return { ok: false, reason: "too_large" };
  if (!botIdHeader || !signatureHeader) return { ok: false, reason: "missing_headers" };
  const botId = botIdHeader.trim();
  if (!isValidBotId(botId)) return { ok: false, reason: "bad_bot_id" };
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: "bad_signature_format" };
  const nowSeconds = Math.floor(nowMs / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > BOT_BRIDGE_MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const secret = secretFor(botId);
  if (!secret) return { ok: false, reason: "unknown_bot" };
  const expected = signBridgePayload(secret, parsed.timestamp, rawBody);
  // Check every candidate so timing does not reveal which one matched.
  let matched: string | null = null;
  for (const candidate of parsed.signatures) {
    if (timingSafeEqualString(candidate, expected) && matched === null) matched = candidate;
  }
  if (!matched) return { ok: false, reason: "bad_signature" };
  return { ok: true, botId, timestamp: parsed.timestamp, signature: matched };
}

/**
 * Per-isolate memory of recently accepted signatures. Defence in depth only:
 * Workers isolates do not share it, so the durable replay guard is the
 * `(user_id, dedupe_key)` unique index once M4 lands. Entries live for twice
 * the skew window, after which the timestamp check rejects the request anyway.
 */
export class RecentSignatureCache {
  private readonly seen = new Map<string, number>();
  constructor(
    private readonly ttlMs = 2 * BOT_BRIDGE_MAX_SKEW_SECONDS * 1000,
    private readonly maxEntries = 5000,
  ) {}

  /** True if this signature was already accepted (a replay). Records it otherwise. */
  checkAndRemember(key: string, nowMs = Date.now()): boolean {
    for (const [k, expiry] of this.seen) {
      if (expiry > nowMs && this.seen.size <= this.maxEntries) break;
      this.seen.delete(k);
    }
    const expiry = this.seen.get(key);
    if (expiry !== undefined && expiry > nowMs) return true;
    this.seen.set(key, nowMs + this.ttlMs);
    return false;
  }

  /**
   * Undo `checkAndRemember` for a request that was not processed (rate limited
   * or storage failure), so the sender's retry of the same signed request is
   * handled instead of being answered as a duplicate.
   */
  forget(key: string): void {
    this.seen.delete(key);
  }

  clear(): void {
    this.seen.clear();
  }
}
