import Stripe from "stripe";
import { billingConfig } from "./catalog";

export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

let cached: { key: string; client: Stripe } | null = null;

/** A StripeClient instance (never the global-key pattern). Null when billing is off. */
export function getStripe(): Stripe | null {
  const cfg = billingConfig();
  if (!cfg.enabled) return null;
  if (cached?.key !== cfg.secretKey) {
    cached = {
      key: cfg.secretKey,
      client: new Stripe(cfg.secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2 }),
    };
  }
  return cached.client;
}

/** For tests. */
export function resetStripeClient(): void {
  cached = null;
}
