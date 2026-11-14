/**
 * /api/calendar — calendar awareness for Settings > Day Rhythm.
 *
 * GET    /                         status: availability + connections (never tokens or titles)
 * POST   /connect/:provider        returns the provider sign-in URL (opt-in)
 * GET    /oauth/:provider/callback provider redirect target; stores the encrypted token
 * POST   /sync                     refresh busy blocks now (at most every 5 minutes)
 * DELETE /:provider                disconnect: revoke where possible, delete the token
 *
 * Busy/free only. Requires the senses switch (ANIMA_KERNEL_SENSES), the token
 * key (ANIMA_CALENDAR_TOKEN_KEY) and the provider's OAuth client secrets.
 */
import { getAuth } from "@clerk/express";
import { Router, type Request, type Response } from "express";
import {
  CALENDAR_MIN_SYNC_GAP_MS,
  calendarAvailability,
  completeConnection,
  disconnectCalendar,
  newOAuthState,
  openOAuthState,
  sealOAuthState,
  syncCalendarBusy,
} from "../lib/calendar/calendarSync";
import { listConnections, loadCalendarBusy } from "../lib/calendar/calendarStore";
import { authorizeUrl, calendarRedirectOrigin, isCalendarProvider, providerConfig } from "../lib/calendar/providers";
import { calendarKeyBytes, pkceChallenge } from "../lib/calendar/tokenCrypto";
import { readRuntimeEnv } from "../lib/cloudflareEnv";

const router = Router();
export const CALENDAR_STATE_COOKIE = "anima_cal_oauth";
const COOKIE_PATH = "/api/calendar/oauth";

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function stateCookie(value: string, maxAgeSeconds: number): string {
  const secure = calendarRedirectOrigin()?.startsWith("https:") ? "; Secure" : "";
  return `${CALENDAR_STATE_COOKIE}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

/** Back to Settings > Interface (where Day Rhythm lives) with a short outcome code. */
function settingsRedirect(res: Response, outcome: string, provider?: string) {
  const origin = calendarRedirectOrigin() ?? "";
  const qs = new URLSearchParams({ section: "interface", calendar: outcome });
  if (provider) qs.set("provider", provider);
  res.setHeader("Set-Cookie", stateCookie("", 0));
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, `${origin}/settings?${qs.toString()}`);
}

router.get("/", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const availability = calendarAvailability();
    const [connections, busy] = await Promise.all([listConnections(userId), loadCalendarBusy(userId)]);
    res.json({
      ...availability,
      connections: connections.map((c) => ({
        provider: c.provider,
        status: c.status,
        connectedAt: c.createdAt,
        lastSyncedAt: c.lastSyncedAt,
        lastError: c.lastError,
      })),
      busy: busy ? { receivedAt: busy.receivedAt, providers: busy.providers, busyBlocks: busy.busy.length } : null,
    });
  } catch (err) {
    console.error("GET /api/calendar failed:", err);
    res.status(500).json({ error: "Failed to load calendar status" });
  }
});

router.post("/connect/:provider", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const provider = req.params.provider;
  if (!isCalendarProvider(provider)) {
    res.status(404).json({ error: "Unknown calendar provider" });
    return;
  }
  const availability = calendarAvailability();
  if (!availability.enabled) {
    res.status(409).json({ error: "Senses are switched off", enabled: false });
    return;
  }
  const key = calendarKeyBytes(readRuntimeEnv("ANIMA_CALENDAR_TOKEN_KEY"));
  const cfg = providerConfig(provider);
  if (!key || !cfg) {
    res.status(503).json({ error: "Calendar sign-in is not configured on the server", code: "not_configured" });
    return;
  }
  try {
    const state = newOAuthState(userId, provider);
    const sealed = await sealOAuthState(state, key);
    // Binds the callback to this browser so a sign-in link started by someone
    // else cannot attach the victim's calendar to the starter's account.
    res.setHeader("Set-Cookie", stateCookie(state.nonce, 600));
    res.setHeader("Cache-Control", "no-store");
    res.json({ url: authorizeUrl(cfg, sealed, await pkceChallenge(state.verifier)) });
  } catch (err) {
    console.error("POST /api/calendar/connect failed:", err);
    res.status(500).json({ error: "Failed to start calendar sign-in" });
  }
});

router.get("/oauth/:provider/callback", async (req, res) => {
  const provider = req.params.provider;
  if (!isCalendarProvider(provider)) {
    res.status(404).json({ error: "Unknown calendar provider" });
    return;
  }
  const q = req.query as Record<string, unknown>;
  if (typeof q.error === "string") {
    settingsRedirect(res, q.error === "access_denied" ? "denied" : "error", provider);
    return;
  }
  const key = calendarKeyBytes(readRuntimeEnv("ANIMA_CALENDAR_TOKEN_KEY"));
  if (!key || !calendarAvailability().enabled) {
    settingsRedirect(res, "unavailable", provider);
    return;
  }
  const code = typeof q.code === "string" ? q.code : "";
  const sealed = typeof q.state === "string" ? q.state : "";
  const state = sealed ? await openOAuthState(sealed, key) : null;
  const cookieNonce = readCookie(req, CALENDAR_STATE_COOKIE);
  if (!code || !state || state.provider !== provider || !cookieNonce || cookieNonce !== state.nonce) {
    settingsRedirect(res, "invalid_state", provider);
    return;
  }
  try {
    await completeConnection(state, code);
    settingsRedirect(res, "connected", provider);
  } catch (err) {
    const codeName = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "error";
    console.error("Calendar OAuth callback failed:", provider, codeName);
    settingsRedirect(res, codeName === "scope_missing" ? "scope_missing" : "error", provider);
  }
});

router.post("/sync", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!calendarAvailability().enabled) {
    res.status(409).json({ error: "Senses are switched off", enabled: false });
    return;
  }
  try {
    const stored = await loadCalendarBusy(userId);
    if (stored && Date.now() - Date.parse(stored.receivedAt) < CALENDAR_MIN_SYNC_GAP_MS) {
      res.json({ synced: false, cached: true, busyBlocks: stored.busy.length, providers: stored.providers, errors: [] });
      return;
    }
    const result = await syncCalendarBusy(userId, { previous: stored });
    res.json({ synced: result.synced, cached: false, busyBlocks: result.busyBlocks, providers: result.providers, errors: result.errors });
  } catch (err) {
    console.error("POST /api/calendar/sync failed:", err);
    res.status(500).json({ error: "Failed to sync calendar" });
  }
});

router.delete("/:provider", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const provider = req.params.provider;
  if (!isCalendarProvider(provider)) {
    res.status(404).json({ error: "Unknown calendar provider" });
    return;
  }
  try {
    const result = await disconnectCalendar(userId, provider);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("DELETE /api/calendar failed:", err);
    res.status(500).json({ error: "Failed to disconnect calendar" });
  }
});

export default router;
