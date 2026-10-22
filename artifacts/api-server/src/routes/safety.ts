/**
 * /api/safety — server-side safety gates the client only reflects.
 *   GET  /api/safety/status            { is_steward, age: { status, method, attested_at } | null, adult_eligible, self_declaration_locked }
 *   POST /api/safety/age-attestation   { dob: "YYYY-MM-DD", confirm: true } → { status, adult_eligible }
 *   POST /api/safety/age-attestation/revoke → { status: "revoked" }
 * The DOB is checked in memory; only birth year + computed age are stored.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import { callerIsProtocolSteward } from "../lib/protocolUpgradeAuth";
import {
  AgeInputError,
  activeAgeProvider,
  appendAttestation,
  attestationHistory,
  isAdultAttested,
  selfDeclarationLocked,
  type AgeVerificationProvider,
} from "../lib/safety/ageGate";

type Deps = {
  steward: (input: { userId: string; sessionClaims?: unknown }) => Promise<{ allowed: boolean }>;
  history: typeof attestationHistory;
  append: typeof appendAttestation;
  provider: () => AgeVerificationProvider;
};

const defaults: Deps = {
  steward: callerIsProtocolSteward,
  history: attestationHistory,
  append: appendAttestation,
  provider: () => activeAgeProvider(),
};

export function createSafetyRouter(deps: Deps = defaults): IRouter {
  const router: IRouter = Router();
  router.use(createRateLimit({ name: "safety", max: 20, windowMs: 60_000 }));

  router.get("/status", async (req: Request, res: Response) => {
    const { userId, sessionClaims } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const [steward, history] = await Promise.all([
        deps.steward({ userId, sessionClaims }).catch(() => ({ allowed: false })),
        deps.history(userId),
      ]);
      const latest = history[0] ?? null;
      res.json({
        is_steward: steward.allowed,
        age: latest ? { status: latest.status, method: latest.method, attested_at: latest.attested_at } : null,
        adult_eligible: isAdultAttested(latest),
        self_declaration_locked: selfDeclarationLocked(history),
      });
    } catch (err) {
      logger.warn({ err }, "safety status failed");
      res.status(503).json({ error: "Safety status unavailable." });
    }
  });

  router.post("/age-attestation", async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: "Confirmation is required.", code: "confirm_required" });
      return;
    }
    try {
      const provider = deps.provider();
      const history = await deps.history(userId);
      if (provider.method === "self_declared_dob" && selfDeclarationLocked(history)) {
        res.status(403).json({
          error: "Adult mode can't be enabled on this account.",
          code: "self_declaration_locked",
        });
        return;
      }
      const result = await provider.verify({ userId, dob: req.body?.dob });
      const row = await deps.append({
        userId,
        status: result.status,
        method: provider.method,
        provider: provider.method === "provider" ? provider.id : null,
        providerRef: result.providerRef ?? null,
        birthYear: result.birthYear,
        ageYears: result.ageYears,
      });
      res.status(result.status === "attested" ? 200 : 403).json({
        status: row.status,
        attested_at: row.attested_at,
        adult_eligible: isAdultAttested(row),
        ...(result.status === "rejected" ? { code: "under_age", error: "Adult mode is for people 18 and over." } : {}),
      });
    } catch (err) {
      if (err instanceof AgeInputError) {
        res.status(400).json({ error: err.message, code: err.code });
        return;
      }
      logger.error({ err }, "age attestation failed");
      res.status(503).json({ error: "Couldn't save that right now." });
    }
  });

  router.post("/age-attestation/revoke", async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const row = await deps.append({ userId, status: "revoked", method: deps.provider().method });
      res.json({ status: row.status, adult_eligible: false });
    } catch (err) {
      logger.error({ err }, "age attestation revoke failed");
      res.status(503).json({ error: "Couldn't save that right now." });
    }
  });

  return router;
}

export default createSafetyRouter();
