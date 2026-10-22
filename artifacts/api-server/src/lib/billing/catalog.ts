/**
 * Paid add-ons sold through Stripe Checkout (one-time payments, test mode).
 * Text chat is free and never gated. Price ids and amounts live in server env
 * only; the client sends an offer id, never a price or a quantity.
 */
export const OFFER_IDS = ["photo_credits", "voice_minutes", "deep_mode"] as const;
export type OfferId = (typeof OFFER_IDS)[number];

export type Offer = {
  id: OfferId;
  label: string;
  /** Units granted per purchase: credits, minutes, or days of deep mode. */
  units: number;
  unitLabel: "credits" | "minutes" | "days";
  priceEnv: string;
  priceId: string | null;
};

type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : fallback;
}

export function isOfferId(v: unknown): v is OfferId {
  return typeof v === "string" && (OFFER_IDS as readonly string[]).includes(v);
}

export function offerCatalog(env: Env = process.env): Record<OfferId, Offer> {
  const price = (name: string) => {
    const v = env[name]?.trim();
    return v && v.startsWith("price_") ? v : null;
  };
  return {
    photo_credits: {
      id: "photo_credits",
      label: "Photo credits",
      units: positiveInt(env.STRIPE_PHOTO_CREDITS_PER_PACK, 20),
      unitLabel: "credits",
      priceEnv: "STRIPE_PRICE_PHOTO_CREDITS",
      priceId: price("STRIPE_PRICE_PHOTO_CREDITS"),
    },
    voice_minutes: {
      id: "voice_minutes",
      label: "Voice minutes",
      units: positiveInt(env.STRIPE_VOICE_MINUTES_PER_PACK, 30),
      unitLabel: "minutes",
      priceEnv: "STRIPE_PRICE_VOICE_MINUTES",
      priceId: price("STRIPE_PRICE_VOICE_MINUTES"),
    },
    deep_mode: {
      id: "deep_mode",
      label: "Deep mode (30-day pass)",
      units: positiveInt(env.STRIPE_DEEP_MODE_DAYS, 30),
      unitLabel: "days",
      priceEnv: "STRIPE_PRICE_DEEP_MODE",
      priceId: price("STRIPE_PRICE_DEEP_MODE"),
    },
  };
}

export type BillingConfig =
  | { enabled: true; secretKey: string; webhookSecret: string }
  | { enabled: false; reason: "missing_keys" | "live_key_refused" };

/**
 * Test mode only. A live key (sk_live_ / rk_live_) disables billing rather
 * than risk a real charge; going live is a separate, explicit decision.
 */
export function billingConfig(env: Env = process.env): BillingConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() || "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || "";
  if (!secretKey || !webhookSecret) return { enabled: false, reason: "missing_keys" };
  if (!/^(sk|rk)_test_/.test(secretKey)) return { enabled: false, reason: "live_key_refused" };
  return { enabled: true, secretKey, webhookSecret };
}
