---
name: Anima cross-device sync e2e test
description: The committed Playwright cross-device sync/isolation e2e test, its Clerk-CAPTCHA bypass, and the init-script gotcha that wasted the most time.
---

# Cross-device sync e2e (browser) test

A committed Playwright suite lives at `artifacts/anima-protocol/e2e/cross-device-sync.spec.ts`
(config `playwright.config.ts`, `globalSetup` in `e2e/global-setup.ts`, Clerk backend
user helpers in `e2e/clerk-backend.ts`). Run with `pnpm --filter @workspace/anima-protocol run test:e2e`.
It hits the dev domain (`baseURL = E2E_BASE_URL || https://$REPLIT_DEV_DOMAIN`) because only
the proxy domain routes both `/` and `/api`. Chromium binary + Nix system libs (see `replit.nix`)
are required; install the binary in the FOREGROUND (`pnpm exec playwright install chromium`),
backgrounded installs die.

**Clerk CAPTCHA bypass:** programmatic sign-IN only. `clerkSetup()` + `setupClerkTestingToken({page})`
BEFORE `page.goto("/")`, then `clerk.signIn({page, emailAddress})` (ticket strategy, no password/UI).
Backend test users use `+clerk_test` emails. Call `clerkSetup()` again in `beforeAll` — the worker
process may not inherit global-setup's env (CLERK_FAPI / CLERK_TESTING_TOKEN). Never script clicks on
Clerk UI (sign-UP trips a Cloudflare challenge).

**THE gotcha that cost the most time — never touch `document.documentElement` in an `addInitScript`:**
appending a node (e.g. a `<style>`) to `document.documentElement` inside an init script runs BEFORE the
HTML parser, and corrupts/discards the streamed document — `page.goto("/")` returns 200 but
`page.content()` is a near-empty stub (~47–88 bytes), the app JS never runs, and `window.Clerk` stays
undefined so `clerk.signIn` times out at "loaded". Symptom looks exactly like a Clerk-load failure but
is NOT. Fix: defer DOM mutation to a `DOMContentLoaded` listener and append to `document.head`.
`localStorage.setItem` in the init script is fine (it doesn't touch the parse tree).

**Overlay handling (fresh context):** pre-accept the AI disclaimer modal (z-999, intercepts clicks,
renders async) via init-script `localStorage.setItem("ai_disclaimer_accepted","true")`; hide the
Replit dev banner via the deferred style above; dismiss the analytics consent dialog (mixpanel-backed,
not localStorage, so it reappears per context) by clicking its Accept after load.

**Test shape:** account A (fresh context) → sign in → /characters → wait for starter ("Korra",
CSS-uppercased but accessible name keeps case; `getByRole("heading")` is case-insensitive) → New
Character → fill placeholder "e.g. Serenity" → Create → assert visible → reload → assert still present
(proves server-backed). Account B in a SEPARATE context → sign in → assert own seeded roster present but
A's unique custom character (`toHaveCount(0)`) absent (server scopes `/api/store` to the Clerk user id).
Use a random unique custom-character name to avoid cross-run collisions; run serial (B reads the name A made).

**Harmless noise:** `[reqfail] ... net::ERR_ABORTED` on `/api/...` are in-flight requests cancelled by
navigation/reload, not failures.
