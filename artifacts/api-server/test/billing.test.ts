import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import Stripe from "stripe";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));
vi.mock("@workspace/db", () => ({ getPool: () => { throw new Error("no db in unit tests"); } }));

import { billingConfig, offerCatalog } from "../src/lib/billing/catalog";
import {
  consumeEntitlement,
  grantForSession,
  handleStripeEvent,
  InsufficientEntitlementError,
  nextActiveUntil,
} from "../src/lib/billing/ledger";
import { checkoutParams, createBillingRouter, returnOrigin } from "../src/routes/billing";
import { createStripeWebhookRouter } from "../src/webhooks/stripe";

const WHSEC = "whsec_test_secret";
const stripe = new Stripe("sk_test_dummy", { apiVersion: "2026-09-30.endive" });

/** In-memory stand-in for the two append-only tables. */
function fakePool() {
  const events = new Map<string, unknown>();
  const ledger: Array<Record<string, any>> = [];
  const sql: string[] = [];
  const client = {
    async query(text: string, values: any[] = []) {
      sql.push(text.trim().split(/\s+/).slice(0, 2).join(" "));
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text) || text.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (text.includes("INSERT INTO public.billing_stripe_events")) {
        if (events.has(values[0])) return { rows: [] };
        events.set(values[0], values);
        return { rows: [{ event_id: values[0] }] };
      }
      if (text.includes("MAX(active_until)")) {
        const rows = ledger.filter((r) => r.user_id === values[0] && r.entitlement === "deep_mode");
        const max = rows.reduce<Date | null>((m, r) => (!m || r.active_until > m ? r.active_until : m), null);
        return { rows: [{ active_until: max }] };
      }
      if (text.includes("SUM(delta)")) {
        const bal = ledger.filter((r) => r.user_id === values[0] && r.entitlement === values[1]).reduce((s, r) => s + r.delta, 0);
        return { rows: [{ balance: bal }] };
      }
      if (text.includes("WHERE idempotency_key")) {
        return { rows: ledger.filter((r) => r.idempotency_key === values[0]) };
      }
      if (text.includes("INSERT INTO public.entitlement_ledger")) {
        const isUse = text.includes("'use'");
        const row = isUse
          ? { user_id: values[0], entitlement: values[1], delta: values[2], idempotency_key: values[3] }
          : { user_id: values[0], entitlement: values[1], delta: values[2], active_until: values[3], idempotency_key: values[6] };
        if (ledger.some((r) => r.idempotency_key === row.idempotency_key)) return { rows: [] };
        ledger.push(row);
        return { rows: [] };
      }
      if (/\b(UPDATE|DELETE)\b/.test(text)) throw new Error("append-only violated");
      throw new Error(`unexpected sql: ${text}`);
    },
    release() {},
  };
  return { pool: { connect: async () => client }, events, ledger, sql };
}

function sessionEvent(id: string, type: string, session: Partial<Stripe.Checkout.Session>, livemode = false) {
  return {
    id,
    type,
    livemode,
    data: { object: { id: "cs_test_1", object: "checkout.session", ...session } },
  } as unknown as Stripe.Event;
}

const paid = {
  payment_status: "paid" as const,
  client_reference_id: "user_1",
  metadata: { user_id: "user_1", offer: "photo_credits" },
};

afterEach(() => {
  for (const k of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PHOTO_CREDITS",
    "STRIPE_PRICE_DEEP_MODE",
    "BILLING_APP_ORIGIN",
  ]) delete process.env[k];
});

describe("billing config", () => {
  it("is off without keys and refuses live keys", () => {
    expect(billingConfig({})).toEqual({ enabled: false, reason: "missing_keys" });
    expect(billingConfig({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: WHSEC })).toEqual({
      enabled: false,
      reason: "live_key_refused",
    });
    expect(billingConfig({ STRIPE_SECRET_KEY: "rk_test_x", STRIPE_WEBHOOK_SECRET: WHSEC }).enabled).toBe(true);
  });
  it("reads price ids from server env only", () => {
    const c = offerCatalog({ STRIPE_PRICE_PHOTO_CREDITS: "price_123", STRIPE_PRICE_DEEP_MODE: "not-a-price" });
    expect(c.photo_credits.priceId).toBe("price_123");
    expect(c.deep_mode.priceId).toBeNull();
    expect(c.voice_minutes.units).toBe(30);
  });
});

describe("checkout params", () => {
  it("uses a server price, metadata, and never payment_method_types", () => {
    const p = checkoutParams({ userId: "user_1", offer: "deep_mode", priceId: "price_d", origin: "https://anima-protocol.com" });
    expect(p.mode).toBe("payment");
    expect(p.line_items).toEqual([{ price: "price_d", quantity: 1 }]);
    expect(p.metadata).toEqual({ user_id: "user_1", offer: "deep_mode" });
    expect(p).not.toHaveProperty("payment_method_types");
    expect(p.integration_identifier).toMatch(/^anima-addons-[a-z]{8}$/);
    expect(p.success_url).toContain("{CHECKOUT_SESSION_ID}");
  });
  it("only returns to configured or local origins", () => {
    expect(returnOrigin({ headers: { origin: "https://evil.example" } }, {})).toBe("https://anima-protocol.com");
    expect(returnOrigin({ headers: { origin: "http://localhost:5173" } }, {})).toBe("http://localhost:5173");
    expect(returnOrigin({ headers: { origin: "http://localhost:5173" } }, { NODE_ENV: "production" })).toBe("https://anima-protocol.com");
    expect(returnOrigin({ headers: {} }, { BILLING_APP_ORIGIN: "https://staging.example/" })).toBe("https://staging.example");
  });
});

describe("grants", () => {
  it("grants only paid, untampered sessions", () => {
    const cat = offerCatalog({});
    expect(grantForSession({ id: "cs", ...paid }, cat)?.delta).toBe(20);
    expect(grantForSession({ id: "cs", ...paid, payment_status: "unpaid" }, cat)).toBeNull();
    expect(grantForSession({ id: "cs", ...paid, client_reference_id: "user_2" }, cat)).toBeNull();
    expect(grantForSession({ id: "cs", ...paid, metadata: { user_id: "user_1", offer: "free_money" } }, cat)).toBeNull();
  });
  it("extends deep mode from the later of now and the current expiry", () => {
    const now = new Date("2026-10-22T00:00:00Z");
    expect(nextActiveUntil(null, 30, now).toISOString()).toBe("2026-11-21T00:00:00.000Z");
    expect(nextActiveUntil(new Date("2026-11-01T00:00:00Z"), 30, now).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(nextActiveUntil(new Date("2026-01-01T00:00:00Z"), 1, now).toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});

describe("handleStripeEvent (idempotent, append-only)", () => {
  it("grants once per event and once per session", async () => {
    const f = fakePool();
    expect(await handleStripeEvent(sessionEvent("evt_1", "checkout.session.completed", paid), f.pool)).toBe("granted");
    expect(await handleStripeEvent(sessionEvent("evt_1", "checkout.session.completed", paid), f.pool)).toBe("duplicate");
    // async_payment_succeeded for the same session must not double-grant
    await handleStripeEvent(sessionEvent("evt_2", "checkout.session.async_payment_succeeded", paid), f.pool);
    expect(f.ledger).toHaveLength(1);
    expect(f.ledger[0]).toMatchObject({ user_id: "user_1", entitlement: "photo_credits", delta: 20 });
    expect(f.sql.some((s) => /UPDATE|DELETE/.test(s))).toBe(false);
  });
  it("records an unpaid (async) completion without granting, then grants on success", async () => {
    const f = fakePool();
    const unpaid = { ...paid, payment_status: "unpaid" as const };
    expect(await handleStripeEvent(sessionEvent("evt_a", "checkout.session.completed", unpaid), f.pool)).toBe("recorded");
    expect(f.ledger).toHaveLength(0);
    expect(await handleStripeEvent(sessionEvent("evt_b", "checkout.session.async_payment_succeeded", paid), f.pool)).toBe("granted");
    expect(f.ledger).toHaveLength(1);
  });
  it("ignores livemode events entirely", async () => {
    const f = fakePool();
    expect(await handleStripeEvent(sessionEvent("evt_l", "checkout.session.completed", paid, true), f.pool)).toBe("ignored_livemode");
    expect(f.events.size).toBe(0);
  });
  it("spends credits as a negative row and refuses overdraft", async () => {
    const f = fakePool();
    await handleStripeEvent(sessionEvent("evt_1", "checkout.session.completed", paid), f.pool);
    expect(await consumeEntitlement({ userId: "user_1", entitlement: "photo_credits", units: 5, idempotencyKey: "img1" }, f.pool)).toBe(15);
    expect(await consumeEntitlement({ userId: "user_1", entitlement: "photo_credits", units: 5, idempotencyKey: "img1" }, f.pool)).toBe(15);
    await expect(
      consumeEntitlement({ userId: "user_1", entitlement: "photo_credits", units: 50, idempotencyKey: "img2" }, f.pool),
    ).rejects.toBeInstanceOf(InsufficientEntitlementError);
    expect(f.ledger.map((r) => r.delta)).toEqual([20, -5]);
  });
});

describe("HTTP routes", () => {
  let server: Server;
  let base = "";
  const handled: Stripe.Event[] = [];
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => ({ id: "cs_test_9", url: "https://checkout.stripe.com/c/pay/cs_test_9", params }));

  beforeAll(async () => {
    const app: Express = express();
    app.use(
      "/api/webhooks",
      createStripeWebhookRouter(() => ({
        verify: (raw, sig) => stripe.webhooks.constructEvent(raw, sig, WHSEC),
        handle: async (e) => {
          handled.push(e);
          return "granted";
        },
      })),
    );
    app.use(express.json());
    app.use(
      "/api/billing",
      createBillingRouter({
        stripe: () => ({ checkout: { sessions: { create } } }) as any,
        balances: async () => ({ photo_credits: 3, voice_minutes: 0, deep_mode_active_until: null }),
      }),
    );
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", () => r());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("verifies the webhook signature on the raw body", async () => {
    const payload = JSON.stringify(sessionEvent("evt_sig", "checkout.session.completed", paid));
    const good = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    const ok = await fetch(`${base}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": good },
      body: payload,
    });
    expect(ok.status).toBe(200);
    expect(handled.map((e) => e.id)).toEqual(["evt_sig"]);

    const forged = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" });
    const bad = await fetch(`${base}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": forged },
      body: payload,
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
    expect(missing.status).toBe(400);
    expect(handled).toHaveLength(1);
  });

  it("creates a checkout session for a signed-in user with the server price", async () => {
    process.env.STRIPE_PRICE_PHOTO_CREDITS = "price_photo";
    const res = await fetch(`${base}/api/billing/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user_1" },
      body: JSON.stringify({ offer: "photo_credits", price: "price_attacker", quantity: 99 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("checkout.stripe.com");
    const params = create.mock.calls[0][0];
    expect(params.line_items).toEqual([{ price: "price_photo", quantity: 1 }]);
    expect(params.client_reference_id).toBe("user_1");
  });

  it("rejects signed-out callers, unknown offers, and unpriced offers", async () => {
    const post = (body: unknown, user?: string) =>
      fetch(`${base}/api/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
        body: JSON.stringify(body),
      });
    expect((await post({ offer: "photo_credits" })).status).toBe(401);
    expect((await post({ offer: "text_chat" }, "user_1")).status).toBe(400);
    expect((await post({ offer: "deep_mode" }, "user_1")).status).toBe(503);
  });

  it("reports status without leaking keys", async () => {
    const res = await fetch(`${base}/api/billing/status`);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.offers.map((o: { id: string }) => o.id)).toEqual(["photo_credits", "voice_minutes", "deep_mode"]);
    expect(JSON.stringify(body)).not.toMatch(/sk_|whsec_|price_/);
  });
});
