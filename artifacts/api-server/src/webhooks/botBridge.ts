/**
 * Inbound Grok Bot → Anima webhooks (plan §1–§5, phase 1–2 skeleton).
 *
 *   POST /api/webhooks/bot-bridge/status   signed status digest
 *   POST /api/webhooks/bot-bridge/message  signed note for one companion
 *
 * Mounted before the JSON body parser: the HMAC is verified on the raw bytes.
 * Behind `ANIMA_BOT_BRIDGE` (off by default). Fails closed: flag off, storage
 * missing (migrations M1–M4 not applied) or any storage error → 503
 * `bridge_disabled`, nothing stored. Bad or missing signature, stale
 * timestamp or unknown bot → 401, with no hint which check failed.
 *
 * The owning user always comes from the server-side registry, never from the
 * request; the payload schemas reject unknown keys such as `user_id`.
 */
import express, { type NextFunction, type Request, type Response, Router } from "express";
import { logger } from "../lib/logger";
import { classifyText } from "../lib/search/searchCore";
import {
  BOT_BRIDGE_MESSAGE_MAX_BYTES_CEILING,
  BOT_BRIDGE_STATUS_MAX_BYTES_CEILING,
  isBotBridgeFlagOn,
  isValidBotId,
  readBotBridgeLimits,
  readBotSecret,
  readStatusPublishers,
} from "../lib/botBridge/config";
import {
  BotMessageSchema,
  BotStatusDigestSchema,
  describeIssues,
  isTooFarInFuture,
} from "../lib/botBridge/schemas";
import { BOT_HEADER, RecentSignatureCache, SIGNATURE_HEADER, verifyBridgeRequest } from "../lib/botBridge/signature";
import { getBotBridgeStorage, type BotBridgeStorage } from "../lib/botBridge/storage";

type Kind = "status" | "message";

export type BotBridgeWebhookOptions = {
  storage?: () => BotBridgeStorage;
  env?: (name: string) => string | undefined;
  now?: () => number;
  replayCache?: RecentSignatureCache;
};

function deny(res: Response, status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error, code, ...extra });
}

const disabled = (res: Response) =>
  deny(res, 503, "bridge_disabled", "The bot bridge is not enabled on this server.");

export function createBotBridgeWebhookRouter(options: BotBridgeWebhookOptions = {}): Router {
  const storageFor = options.storage ?? getBotBridgeStorage;
  const env = options.env;
  const now = options.now ?? Date.now;
  const replayCache = options.replayCache ?? new RecentSignatureCache();
  const router = Router();

  const handle = (kind: Kind) => async (req: Request, res: Response) => {
    if (!isBotBridgeFlagOn(env)) return disabled(res);
    if (!req.is("application/json") || !Buffer.isBuffer(req.body)) {
      return deny(res, 415, "unsupported_media_type", "Send application/json.");
    }
    const limits = readBotBridgeLimits(env);
    const rawBody = req.body as Buffer;
    const nowMs = now();
    const auth = verifyBridgeRequest({
      botIdHeader: req.header(BOT_HEADER),
      signatureHeader: req.header(SIGNATURE_HEADER),
      rawBody,
      maxBytes: kind === "status" ? limits.statusMaxBytes : limits.messageMaxBytes,
      secretFor: (botId) => readBotSecret(botId, env),
      nowMs,
    });
    if (!auth.ok) {
      const headerBot = req.header(BOT_HEADER)?.trim();
      logger.warn(
        { route: `bot-bridge/${kind}`, reason: auth.reason, bot: isValidBotId(headerBot) ? headerBot : undefined },
        "bot bridge request rejected",
      );
      if (auth.reason === "too_large") return deny(res, 413, "payload_too_large", "Request body is too large.");
      return deny(res, 401, "bridge_unauthorized", "Unauthorized");
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return deny(res, 400, "invalid_json", "Body is not valid JSON.");
    }
    const parsed = kind === "status" ? BotStatusDigestSchema.safeParse(json) : BotMessageSchema.safeParse(json);
    if (!parsed.success) {
      return deny(res, 400, "invalid_payload", "Payload failed validation.", { issues: describeIssues(parsed.error) });
    }
    const payload = parsed.data;
    const stamps = "bots" in payload ? payload.bots.map((b) => b.as_of) : [payload.sent_at];
    if (stamps.some((s) => isTooFarInFuture(s, nowMs))) {
      return deny(res, 400, "invalid_payload", "Payload failed validation.", {
        issues: [{ path: kind === "status" ? "bots.as_of" : "sent_at", message: "is in the future" }],
      });
    }
    if ("bots" in payload) {
      const publishers = readStatusPublishers(env);
      if (!publishers.has(auth.botId) && payload.bots.some((b) => b.bot_id !== auth.botId)) {
        return deny(res, 403, "not_status_publisher", "This bot may only report its own status.");
      }
    }

    const storage = storageFor();
    const replayKey = `${auth.botId}:${auth.signature}`;
    let remembered = false;
    try {
      if (!(await storage.isAvailable())) return disabled(res);
      if (replayCache.checkAndRemember(replayKey, nowMs)) {
        return res.status(200).json({ status: "duplicate" });
      }
      remembered = true;
      const bot = await storage.resolveBot(auth.botId);
      if (!bot) {
        logger.warn({ route: `bot-bridge/${kind}`, reason: "not_registered", bot: auth.botId }, "bot bridge request rejected");
        return deny(res, 403, "bridge_forbidden", "Forbidden");
      }
      if (!bot.inboundEnabled) {
        await storage.logDenied(bot, "inbound_disabled", nowMs);
        return deny(res, 403, "bridge_forbidden", "Forbidden");
      }
      if (await storage.isKilled(bot.userId)) {
        // Kill switch: accepted and dropped, logged as denied (plan §5 item 9).
        await storage.logDenied(bot, "killed", nowMs);
        return res.status(202).json({ status: "dropped" });
      }
      const counts = await storage.countInbound(bot.userId, bot.botId, nowMs);
      if (counts.botLastMinute >= limits.inboundPerMinutePerBot || counts.userLastDay >= limits.inboundPerDayPerUser) {
        await storage.logDenied(bot, "rate_limited", nowMs);
        // Not processed: let the bot's retry of this exact request through later.
        replayCache.forget(replayKey);
        const retryAfter = counts.botLastMinute >= limits.inboundPerMinutePerBot ? 60 : 3600;
        res.setHeader("Retry-After", String(retryAfter));
        return deny(res, 429, "rate_limited", "Too many bridge requests.");
      }

      if ("bots" in payload) {
        const out = await storage.saveStatus(bot, payload.dedupe_key, payload.bots, nowMs);
        if (out.status === "duplicate") return res.status(200).json({ status: "duplicate" });
        return res.status(202).json({ status: "accepted" });
      }

      const flags = classifyText(payload.body);
      if (flags.includes("nsfw")) {
        // Adult content never enters the bridge (plan §5 item 6).
        await storage.logDenied(bot, "flagged_adult", nowMs);
        return res.status(202).json({ status: "dropped" });
      }
      const out = await storage.saveMessage(bot, payload, flags, nowMs);
      if (out.status === "duplicate") return res.status(200).json({ status: "duplicate" });
      if (out.status === "unknown_companion") {
        return deny(res, 422, "unknown_companion", "No such companion for this bot's owner.");
      }
      // Push to the owner (quiet hours respected) lands with M4; see docs/bot-bridge.md.
      return res.status(202).json({ status: "accepted", id: out.id });
    } catch (err) {
      // Nothing was stored; a retry of the same signed request must not read as a duplicate.
      if (remembered) replayCache.forget(replayKey);
      logger.error({ route: `bot-bridge/${kind}`, err: err instanceof Error ? err.message : "error" }, "bot bridge storage failed");
      return disabled(res);
    }
  };

  const raw = (limit: number) => express.raw({ type: () => true, limit });
  const tooLarge = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large" || e?.status === 413) {
      return deny(res, 413, "payload_too_large", "Request body is too large.");
    }
    if (e?.status && e.status >= 400 && e.status < 500) return deny(res, 400, "bad_request", "Bad request.");
    return next(err);
  };

  // Flag check first, so a disabled bridge does no body parsing or secret reads.
  const gate = (_req: Request, res: Response, next: NextFunction) => {
    if (!isBotBridgeFlagOn(env)) return disabled(res);
    return next();
  };

  router.post("/status", gate, raw(BOT_BRIDGE_STATUS_MAX_BYTES_CEILING), handle("status"), tooLarge);
  router.post("/message", gate, raw(BOT_BRIDGE_MESSAGE_MAX_BYTES_CEILING), handle("message"), tooLarge);
  return router;
}

const botBridgeWebhookRouter = createBotBridgeWebhookRouter();
export default botBridgeWebhookRouter;
