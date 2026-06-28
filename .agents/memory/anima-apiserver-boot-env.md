---
name: api-server boot env requirements vs local dev
description: Why the anima api-server can refuse to boot locally (CLERK_WEBHOOK_SECRET) and break character/store loading, and the correct gating.
---

# api-server boot-time requireEnv can break local dev (and thus character loading)

The standalone api-server entry (`artifacts/api-server/src/index.ts`) fail-fasts on missing env at module load. `DATABASE_URL` and `CLERK_SECRET_KEY` are genuinely required everywhere. But `CLERK_WEBHOOK_SECRET` is **only** consumed by the `/api/webhooks/clerk` svix verification route, which only fires in production where Clerk delivers webhooks. The Replit dev environment does **not** have `CLERK_WEBHOOK_SECRET` set, so an unconditional `requireEnv("CLERK_WEBHOOK_SECRET")` crashes the dev server at boot.

**Symptom that looks like a different bug:** "characters don't load" / store data missing in the local preview. Root cause is the dead api-server — the web client's `/api/store` calls (base44Client) get connection-refused, so `Character.list()` returns nothing. The seeding code (`src/lib/seedCharacters.js`) is a red herring; the bootstrap caller (`syncBootstrap.js`) already wraps `seedCharactersIfNeeded()` in try/catch so a seed failure never white-screens.

**Fix:** gate the webhook-secret requirement — `requireEnv("CLERK_WEBHOOK_SECRET")` only when `NODE_ENV === "production"`, else `logger.warn` and continue.
**Why safe for prod:** the Vercel entry is `src/vercel.ts` which is just `export default app` (NO boot-time requireEnv), so Vercel was never affected; Vercel also has the secret set. The webhook route reads the secret per-request and rejects if absent — acceptable in dev (no webhooks).
**How to apply:** if api-server workflow shows `Missing required environment variable: CLERK_WEBHOOK_SECRET` and the env var is UNSET, do NOT request a fabricated secret — relax the boot gate. Confirm with `curl localhost:<port>/api/health` → 200.

Pre-existing (not from this) api-server typecheck errors live in `routes/store.ts` (drizzle/`pg` duplicate-version declaration clash) and `webhooks/clerk.ts` (not-all-paths-return); the dev/build path is esbuild so tsc errors don't block runtime.
