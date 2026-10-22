/**
 * Steward-only checks as API middleware (audit P1-6). The client may show or
 * hide steward UI, but the server decides.
 */
import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { callerIsProtocolSteward } from "../protocolUpgradeAuth";

type StewardCheck = (input: { userId: string; sessionClaims?: unknown }) => Promise<{ allowed: boolean }>;

/** 401 signed out, 403 non-steward; sets res.locals.isSteward on pass. */
export function requireSteward(opts: { check?: StewardCheck; code?: string; message?: string } = {}) {
  const check = opts.check ?? callerIsProtocolSteward;
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId, sessionClaims } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const { allowed } = await check({ userId, sessionClaims });
      if (!allowed) {
        res.status(403).json({ error: opts.message ?? "Restricted to the Protocol steward.", code: opts.code ?? "not_steward" });
        return;
      }
      res.locals.isSteward = true;
      next();
    } catch {
      res.status(503).json({ error: "Steward check unavailable.", code: "steward_check_failed" });
    }
  };
}

/** Profile flags only the steward may hold (settings.<section>.<flag>). */
export const STEWARD_GRANT_FLAGS: ReadonlyArray<readonly [section: string, flag: string]> = [
  ["echo_keys", "granted_full_library"],
  ["energy_fragments", "granted_full_library"],
  ["memory_crystals", "granted_all_types"],
  ["inventory", "granted_full_catalog"],
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/**
 * Pure: sanitise a profile write. Non-stewards lose steward grant flags;
 * adult mode can't be switched on without an age attestation. Returns the
 * cleaned copy and what was stripped (for logs/tests).
 */
export function sanitizeProfileWrite(
  data: Record<string, unknown>,
  ctx: { isSteward: boolean; adultAttested: boolean },
): { data: Record<string, unknown>; stripped: string[] } {
  const stripped: string[] = [];
  if (!isRecord(data.settings)) return { data, stripped };
  const settings: Record<string, unknown> = { ...data.settings };
  if (!ctx.isSteward) {
    for (const [section, flag] of STEWARD_GRANT_FLAGS) {
      const sec = settings[section];
      if (isRecord(sec) && sec[flag] === true) {
        settings[section] = { ...sec, [flag]: false };
        stripped.push(`settings.${section}.${flag}`);
      }
    }
  }
  if (!ctx.adultAttested && settings.adult_content_enabled === true) {
    settings.adult_content_enabled = false;
    stripped.push("settings.adult_content_enabled");
  }
  return { data: { ...data, settings }, stripped };
}

/** Does this write need the (Clerk-backed) steward lookup at all? */
export function profileWriteNeedsStewardCheck(data: Record<string, unknown>): boolean {
  const settings = data.settings;
  if (!isRecord(settings)) return false;
  return STEWARD_GRANT_FLAGS.some(([s, f]) => isRecord(settings[s]) && (settings[s] as Record<string, unknown>)[f] === true);
}
