/**
 * /api/billing — Stripe Checkout for paid add-ons (test mode only).
 *   GET  /api/billing/status     { enabled, offers: [{id,label,units,unit_label,available}], balances? }
 *   POST /api/billing/checkout   { offer } → { url }   (server picks the price; client never sends one)
 * Fulfillment happens only in the signed webhook (webhooks/stripe.ts), never
 * on the success page.
 */
import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import type Stripe from "stripe";
import { createRateLimit } from "../lib/rateLimit";
import { logger } from "../lib/logger";
import { billingConfig, isOfferId, offerCatalog, type OfferId } from "../lib/billing/catalog";
import { getStripe } from "../lib/billing/stripeClient";
import { entitlementBalances } from "../lib/billing/ledger";

const DEFAULT_APP_ORIGIN = "https://anima-protocol.com";
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/;

/** Where Checkout returns. BILLING_APP_ORIGIN wins; localhost is honoured outside production. */
export function returnOrigin(req: Pick<Request, "headers">, env = process.env): string {
  const configured = env.BILLING_APP_ORIGIN?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(origin)) return origin;
  return DEFAULT_APP_ORIGIN;
}

function randomLetters(n: number): string {
  const abc = "abcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(n), (b) => abc[b % 26]).join("");
}

export function checkoutParams(input: {
  userId: string;
  offer: OfferId;
  priceId: string;
  origin: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.userId,
    metadata: { user_id: input.userId, offer: input.offer },
    payment_intent_data: { metadata: { user_id: input.userId, offer: input.offer } },
    success_url: `${input.origin}/premium?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/premium?checkout=cancelled`,
    integration_identifier: `anima-addons-${randomLetters(8)}`,
  };
}

type Deps = {
  stripe: () => Pick<Stripe, "checkout"> | null;
  balances: typeof entitlementBalances;
};

export function createBillingRouter(deps: Deps = { stripe: getStripe, balances: entitlementBalances }): IRouter {
  const router: IRouter = Router();
  router.use(createRateLimit({ name: "billing", max: 30, windowMs: 60_000 }));

  router.get("/status", async (req: Request, res: Response) => {
    const cfg = billingConfig();
    const catalog = offerCatalog();
    const offers = Object.values(catalog).map((o) => ({
      id: o.id,
      label: o.label,
      units: o.units,
      unit_label: o.unitLabel,
      available: cfg.enabled && Boolean(o.priceId),
    }));
    const { userId } = getAuth(req);
    let balances: Awaited<ReturnType<typeof entitlementBalances>> | null = null;
    if (userId && cfg.enabled) {
      balances = await deps.balances(userId).catch((err) => {
        logger.warn({ err }, "billing balances unavailable");
        return null;
      });
    }
    res.json({ enabled: cfg.enabled, test_mode: true, offers, balances });
  });

  router.post("/checkout", async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const offer = req.body?.offer;
    if (!isOfferId(offer)) {
      res.status(400).json({ error: "Unknown offer", code: "invalid_offer" });
      return;
    }
    const stripe = deps.stripe();
    const priceId = offerCatalog()[offer].priceId;
    if (!stripe || !priceId) {
      res.status(503).json({ error: "Payments are coming soon.", code: "payments_coming_soon" });
      return;
    }
    try {
      const session = await stripe.checkout.sessions.create(
        checkoutParams({ userId, offer, priceId, origin: returnOrigin(req) }),
      );
      if (!session.url) throw new Error("Checkout session has no url");
      res.json({ url: session.url, id: session.id });
    } catch (err) {
      logger.error({ err, offer }, "stripe checkout session failed");
      res.status(502).json({ error: "Couldn't start checkout. Please try again.", code: "checkout_failed" });
    }
  });

  return router;
}

export default createBillingRouter();
