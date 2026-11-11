import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../lib/rateLimit";
import { recordChatClientFailure } from "../lib/chatClientFailureReport";

const router = Router();

const limitReports = createRateLimit({
  name: "chat-client-failure",
  max: 20,
  windowMs: 60_000,
});

function signedInUserId(req: Request): string | null {
  try {
    const userId = getAuth(req).userId;
    return typeof userId === "string" && userId.trim() ? userId : null;
  } catch {
    return null;
  }
}

function headerUserAgent(req: Request): string {
  const raw = req.headers["user-agent"];
  return typeof raw === "string" ? raw : "";
}

/**
 * One authenticated line per client-side chat failure.
 * Mounted beside `/chat` so it does not run the chat router's schema check.
 */
router.post("/", (req: Request, res: Response) => {
  const userId = signedInUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  limitReports(req, res, () => {
    const outcome = recordChatClientFailure({
      userId,
      body: req.body,
      userAgent: headerUserAgent(req),
    });
    res.setHeader("Cache-Control", "no-store");
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.status(204).end();
  });
});

export default router;
