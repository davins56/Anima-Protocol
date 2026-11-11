/**
 * POST /api/webhooks/stripe — signed Stripe webhook (test mode).
 * Mounted before the JSON body parser: signature verification needs the raw
 * bytes. Unverified requests get 400 and touch nothing. Handling is
 * idempotent (billing_stripe_events PK + ledger idempotency_key), so a
 * redelivery is a 200 no-op. A handler error returns 500 so Stripe retries.
 */
import express, { type Request, type Response } from "express";
import type Stripe from "stripe";
import { billingConfig } from "../lib/billing/catalog";
import { getStripe } from "../lib/billing/stripeClient";
import { handleStripeEvent } from "../lib/billing/ledger";
import { logger } from "../lib/logger";

type Deps = {
  verify: (raw: Buffer, signature: string) => Stripe.Event;
  handle: (event: Stripe.Event) => Promise<string>;
};

function defaultDeps(): Deps | null {
  const cfg = billingConfig();
  const stripe = getStripe();
  if (!cfg.enabled || !stripe) return null;
  return {
    verify: (raw, sig) => stripe.webhooks.constructEvent(raw, sig, cfg.webhookSecret),
    handle: (event) => handleStripeEvent(event),
  };
}

export function createStripeWebhookRouter(resolveDeps: () => Deps | null = defaultDeps) {
  const router = express.Router();
  router.post("/stripe", express.raw({ type: "application/json", limit: "1mb" }), async (req: Request, res: Response) => {
    const deps = resolveDeps();
    if (!deps) {
      res.status(503).json({ error: "Billing not configured" });
      return;
    }
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Missing signature" });
      return;
    }
    let event: Stripe.Event;
    try {
      event = deps.verify(req.body, signature);
    } catch {
      res.status(400).json({ error: "Invalid signature" });
      return;
    }
    try {
      const outcome = await deps.handle(event);
      logger.info({ eventId: event.id, type: event.type, outcome }, "stripe webhook handled");
      res.json({ received: true, outcome });
    } catch (err) {
      logger.error({ err, eventId: event.id, type: event.type }, "stripe webhook failed");
      res.status(500).json({ error: "Webhook handling failed" });
    }
  });
  return router;
}

export default createStripeWebhookRouter();
