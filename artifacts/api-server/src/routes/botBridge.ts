/**
 * Signed-in endpoints for the bot bridge UI (mounted at /api/bridge).
 *
 *   GET  /config                       → { enabled, capabilities }  (always 200 for a signed-in user)
 *   GET  /bots                         → status cards               (503 until storage exists)
 *   GET  /permissions                  → companion × bot matrix      (503 until storage exists)
 *   POST /drafts/:actionId/decision    → Send / Cancel a draft       (503 until storage exists)
 *   POST /messages/:messageId/remember → "Remember this"            (503 until M6)
 *
 * The user is always Clerk's `getAuth(req).userId`; no route reads a user id
 * from the body, query or headers. Everything except /config fails closed
 * with 503 `bridge_disabled` while the flag is off or storage is unavailable,
 * and 501 `bridge_not_implemented` once storage exists but the backend for
 * that action has not landed (outbound needs the tools-guardrails runtime).
 */
import { getAuth } from "@clerk/express";
import { Router, type Request, type Response } from "express";
import { isBotBridgeFlagOn } from "../lib/botBridge/config";
import { getBotBridgeStorage, type BotBridgeStorage } from "../lib/botBridge/storage";

export type BotBridgeRouteOptions = {
  storage?: () => BotBridgeStorage;
  env?: (name: string) => string | undefined;
};

export async function botBridgeEnabled(options: BotBridgeRouteOptions = {}): Promise<boolean> {
  if (!isBotBridgeFlagOn(options.env)) return false;
  try {
    return await (options.storage ?? getBotBridgeStorage)().isAvailable();
  } catch {
    return false;
  }
}

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

export function createBotBridgeRouter(options: BotBridgeRouteOptions = {}): Router {
  const router = Router();

  router.get("/config", async (req, res) => {
    if (!requireUser(req, res)) return;
    const enabled = await botBridgeEnabled(options);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      enabled,
      capabilities: {
        // Each turns true only when its migration and backend land.
        awareness: false,
        inboundMessages: false,
        outboundDrafts: false,
        standingPermission: false,
        remember: false,
      },
    });
  });

  const notYet = async (req: Request, res: Response) => {
    if (!requireUser(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    if (!(await botBridgeEnabled(options))) {
      res.status(503).json({ error: "The bot bridge is not enabled on this server.", code: "bridge_disabled" });
      return;
    }
    res.status(501).json({ error: "Not available yet.", code: "bridge_not_implemented" });
  };

  router.get("/bots", notYet);
  router.get("/permissions", notYet);
  router.put("/permissions", notYet);
  router.post("/drafts/:actionId/decision", notYet);
  router.post("/messages/:messageId/remember", notYet);
  return router;
}

const botBridgeRouter = createBotBridgeRouter();
export default botBridgeRouter;
