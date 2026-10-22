# Pending decisions

Things that need an owner's choice or a dashboard change. Code is in place
where noted; nothing here was changed in any third-party account.

## Clerk (safety gates — feature/safety-gates)

1. **Steward identity by user id.** Set `PROTOCOL_UPGRADE_ADMIN_USER_IDS` to
   the steward's Clerk user id(s) (`user_…`). Without it, the code falls back to
   `PROTOCOL_UPGRADE_ADMIN_EMAILS` or the built-in email defaults, which needs a
   Clerk API lookup.
2. **Email claim in the session token** (Clerk Dashboard → Sessions →
   Customize session token): add `{"email": "{{user.primary_email_address}}"}`
   so steward checks don't call the Clerk Backend API on cache misses.
3. **`CLERK_SECRET_KEY`** must be set on the API host for the email fallback
   (already required by other routes).
4. **Optional:** mirror age status into Clerk `publicMetadata` for other
   apps. This isn't needed; the source of truth is `age_attestations`.
5. **Third-party age verification**: pick a provider before any regulated
   launch (e.g. UK OSA / US state laws require more than self-declaration).
   The integration point is documented in `docs/safety-gates.md`.

## Stripe (feature/stripe-checkout)

- Create products/prices in a **Stripe sandbox** and set
  `STRIPE_SECRET_KEY` (rk_test_ preferred), `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_PHOTO_CREDITS`, `STRIPE_PRICE_VOICE_MINUTES`,
  `STRIPE_PRICE_DEEP_MODE`, `BILLING_APP_ORIGIN`. Live keys are refused by
  code; going live is a separate decision.
- Pack sizes (20 photo credits / 30 voice minutes / 30-day deep mode) are
  placeholders (`STRIPE_*_PER_PACK`, `STRIPE_DEEP_MODE_DAYS`).
- Deep mode as a recurring subscription vs. a pass. It is a pass today.
- Spending hooks (photo/voice/deep-mode consumption) aren't wired yet.

## Reply ratings (feature/reply-ratings)

- Cross-user export of ratings for training is intentionally absent. It
  should only include users with `model_tutor.share_for_training = true`;
  decide the export owner (steward) and retention before adding it.
