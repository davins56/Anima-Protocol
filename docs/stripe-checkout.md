# Stripe Checkout — paid add-ons (test mode only)

Text chat is free and never gated. Three add-ons are sold as one-time
Checkout Sessions (`mode: "payment"`):

| Offer id | Grants | Price env | Units env (default) |
|---|---|---|---|
| `photo_credits` | photo credits | `STRIPE_PRICE_PHOTO_CREDITS` | `STRIPE_PHOTO_CREDITS_PER_PACK` (20) |
| `voice_minutes` | voice minutes | `STRIPE_PRICE_VOICE_MINUTES` | `STRIPE_VOICE_MINUTES_PER_PACK` (30) |
| `deep_mode` | a deep-mode pass, in days | `STRIPE_PRICE_DEEP_MODE` | `STRIPE_DEEP_MODE_DAYS` (30) |

## Server env (API server only; never in the client)

| Var | Required | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Must be a **test** key. A restricted key (`rk_test_…`) is recommended over `sk_test_…`; it needs only Checkout Sessions write. A live key (`sk_live_`/`rk_live_`) turns billing **off**. |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` from the webhook endpoint (or `stripe listen`). |
| `STRIPE_PRICE_PHOTO_CREDITS`, `STRIPE_PRICE_VOICE_MINUTES`, `STRIPE_PRICE_DEEP_MODE` | per offer | `price_…` ids of one-time prices in the test sandbox. An unset offer shows "Coming soon · join waitlist". |
| `BILLING_APP_ORIGIN` | recommended | Where Checkout returns (e.g. `https://anima-protocol.com`). Without it, localhost origins are accepted outside production; otherwise it falls back to `https://anima-protocol.com`. |

Without both keys, `/api/billing/status` reports `enabled: false` and the
page shows the waitlist. Nothing was created in any Stripe account by this
change. Products, prices and the webhook endpoint must be created by the
owner in a **sandbox** (Stripe recommends a separate sandbox over the shared
test mode).

## Flow

1. `POST /api/billing/checkout { offer }` (signed in). The server looks up the
   price from env, creates a Checkout Session with `client_reference_id` and
   `metadata { user_id, offer }`, and returns `url`. The client never sends a
   price or quantity. `payment_method_types` is deliberately omitted
   (dynamic payment methods). Sessions carry
   `integration_identifier: anima-addons-<8 letters>`.
2. Stripe redirects back to `/premium?checkout=success|cancelled`. The page
   only shows a notice; **it does not fulfil**.
3. `POST /api/webhooks/stripe` (raw body, mounted before `express.json`)
   verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`. Bad or missing
   signature → 400, nothing written.
4. `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   grant only when `payment_status === "paid"` and metadata/client reference
   agree. Livemode events are ignored.

## Idempotency and the ledger

Migration `20261022240000_entitlement_ledger.sql` (new objects only):

- `billing_stripe_events`: one row per handled event; PK `event_id`. A
  redelivered event hits the conflict and is a 200 no-op.
- `entitlement_ledger`: append-only (`anima_forbid_mutation` trigger on
  UPDATE/DELETE/TRUNCATE). Purchases are `+units`, uses are `−units`
  (`consumeEntitlement`), keyed by `idempotency_key UNIQUE`
  (`checkout:<session id>`, `use:<key>`). Completed + async-succeeded for one
  session grant once.
- `entitlement_balances` view: sums per user/entitlement; deep mode is active
  while `MAX(active_until) > now()`. A new pass extends from the later of
  now and the current expiry.

Event row + grant are one transaction; a failure returns 500 so Stripe retries.

## Local testing

```bash
stripe listen --forward-to localhost:8080/api/webhooks/stripe   # prints whsec_…
stripe trigger checkout.session.completed
```

Use test card `4242 4242 4242 4242`.

## Remaining

- Spending isn't wired yet: photo generation, voice TTS and the deep-mode
  model tier don't call `consumeEntitlement` / check `deep_mode_active_until`
  yet. Text chat stays free regardless.
- Refunds/disputes (`charge.refunded`) are not handled; they'd append a
  `reason: 'refund'` negative row.
- Deep mode is a 30-day pass, not a recurring subscription.
- Stripe Tax is off: don't enable `automatic_tax` until a tax registration exists.
- `pages/LifetimeAccess.jsx` (legacy `createLifetimeCheckout`) is no longer
  routed from `/premium`; it's left in place and is unused.
