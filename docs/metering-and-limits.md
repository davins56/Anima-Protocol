# Metering and per-user limits for paid AI endpoints

Security audit 2026-11-14, H1. Text chat stays free.

## What is metered

| Endpoint | Durable per-user limit (scope) | Charge before the provider call | Refund |
| --- | --- | --- | --- |
| `POST /api/photo/generate` | `photo` | 1 photo unit | if no `image` event was emitted |
| `POST /api/openai/image-generate` | `photo` | 1 photo unit | on any 4xx/5xx reply |
| `POST /api/openai/image-edit` | `photo` | 1 photo unit | on any 4xx/5xx reply |
| `POST /api/tts` (ElevenLabs) | `voice` | `ceil(chars / 900)` voice units | on provider error |
| `POST /api/voice/:id/session` (xAI realtime) | `voice` | `ANIMA_VOICE_SESSION_UNITS` (default 1) | if minting the session fails |
| `POST /api/media/voice-clip` | (router limiter) | voice units, only when a cloud voice (opt-in) is actually called | on failure |
| `POST /api/voice/:id/speak`, `/transcribe` (home box) | `voice` | none (free, local) | n/a |
| `POST /api/openai/v1/chat/completions` | `chat_proxy` | none (text is free) | n/a |
| `POST /api/openai/invoke/:fn` | `invoke` | none | n/a |

`deep_mode` on the generic chat proxy only applies with an active deep-mode
pass (`entitlement_balances.deep_mode_active_until`); otherwise the request
quietly runs in normal mode. `max_tokens` was already capped server-side
(`resolveMaxTokens`). The main companion chat route is unchanged.

Order for a metered call (`lib/billing/meter.ts`):

1. Durable per-user limit for the scope (429 + `Retry-After`).
2. Free daily allowance (`ANIMA_FREE_PHOTOS_PER_DAY`, default 10;
   `ANIMA_FREE_VOICE_UNITS_PER_DAY`, default 20). Resets 00:00 UTC.
3. `consumeEntitlement()` with a server-generated key. No credits, or no
   `entitlement_ledger` table, is a 402 `insufficient_entitlement`. Any other
   ledger error is a 503 `metering_unavailable` (fail closed).

A refund for a free unit decrements the day counter; a refund for a paid
unit appends a `reason = 'refund'` ledger row keyed `refund:use:<key>`
(idempotent, append-only).

## Durable limiter

`USER_RATE_LIMITER` Durable Object (`lib/usage/userRateLimiterDo.ts`), one
object per Clerk user (`u:<userId>`), fixed minute and day windows. Without
the binding, or if a call throws, the code falls back to in-process counters
(per isolate on Workers: the old behaviour). The older per-isolate IP/user
limiter still runs in front.

## Settings

| Env | Default | Meaning |
| --- | --- | --- |
| `ANIMA_METERING` | on | `off` disables charging (limits still apply) |
| `ANIMA_METERING_EXEMPT_USER_IDS` | empty | Clerk user ids never charged (e.g. the steward) |
| `ANIMA_FREE_PHOTOS_PER_DAY` | 10 | free photo units per user per UTC day |
| `ANIMA_FREE_VOICE_UNITS_PER_DAY` | 20 | free voice units per user per UTC day |
| `ANIMA_VOICE_SESSION_UNITS` | 1 | voice units per realtime session |
| `ANIMA_RL_PHOTO_PER_MIN` / `_PER_DAY` | 6 / 150 | photo requests |
| `ANIMA_RL_VOICE_PER_MIN` / `_PER_DAY` | 30 / 600 | voice requests |
| `ANIMA_RL_CHAT_PROXY_PER_MIN` / `_PER_DAY` | 60 / 2000 | generic chat proxy |
| `ANIMA_RL_INVOKE_PER_MIN` / `_PER_DAY` | 180 / 5000 | `/openai/invoke` |

## Needs an owner's OK before deploy

- `wrangler.jsonc` adds the `USER_RATE_LIMITER` binding and migration tag
  `v2-user-rate-limiter` (`new_sqlite_classes: ["UserRateLimiter"]`). The
  first deploy creates the class. Workers Free includes SQLite-backed DOs.
- The ledger is plain Postgres (`pg` pool, advisory locks, no Supabase
  roles or RLS needed); production is Prisma Postgres (PG 17). The table
  is defined in `supabase/migrations/20261022240000_entitlement_ledger.sql`
  (its Supabase-only grants are skipped when the `authenticated` role is
  absent) and is not in `lib/db` ensure-schema. If the live DB doesn't have
  `entitlement_ledger` / `entitlement_balances`, nobody can spend credits:
  users get the free allowance, then 402 (and deep mode stays off).
  Creating the table there is a separate decision.
- The durable limiter and free-allowance counters live in the Durable
  Object, not in Postgres, so they don't depend on the database at all.
