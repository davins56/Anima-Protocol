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

**Restore-backup spec (`restore-backup.spec.ts`):** drives the REAL Settings UI restore flow (not the
client helper): open `/settings` → click the "Data & Privacy" nav button → `setInputFiles` a JSON backup
onto the hidden `input[type=file]` → the "Restore Backup" dialog → "Merge Into Current Data" OR the
two-step "Replace Everything" (click it, then the confirm-step "Replace Everything"). Success text is
"Merged in N record(s)." / "Replaced everything with N record(s).". Backup carries a LEGACY-shape
ChatSession (inline `messages` blob); opening `/chat/<id>` afterwards lazy-splits it (GET /messages),
proving the conversation — not just characters — comes back. Merge keeps the seeded starter (Korra count 1),
replace wipes it (count 0). One fresh context + own Clerk user per mode; serial.

**Running e2e from the agent:** once the Chromium binary is already installed, specs DO run in-session
via `pnpm --filter @workspace/anima-protocol exec playwright test <file>.spec.ts` (a full 3-test spec
finishes in ~50s, well under the bash limit). Only the initial binary DOWNLOAD blows the 2-min limit. e2e
is NOT in the standard checks (vitest `test` only globs `src/**`; typecheck only covers `src/**`), so
adding a spec won't break them — but the e2e .ts IS typechecked by the anima tsconfig, so keep it clean.

**Consent-banner click interception:** the analytics consent dialog is `fixed inset-x-0 bottom-0 z-[100]`,
so its Accept button shares the bottom strip with the BottomTabBar and a real `.click()` is intercepted
("subtree intercepts pointer events", times out). Fix: `consentAccept.dispatchEvent("click")` fires the
React onClick directly regardless of overlap. (The older specs' positional `.click()` is flake-prone here.)

**Failed-sync notice spec (`failed-sync-notice.spec.ts`):** verifies the Task #91 toast "Your saved data
hasn't synced to your account yet." Force each migration outcome deterministically by intercepting
`**/api/store/import` (the bulkImport endpoint) and fulfilling `{imported:false}` (→"failed", toast shows),
`{imported:true,count:1}` (→"migrated", no toast), or seeding NO local data (→"skipped", import never called,
no toast). Retry action calls `window.location.reload()` — assert via a `window.__preRetry` sentinel that the
reload wipes. For the negative cases, poll migration flag === "1" as the bootstrap-done gate before asserting
the toast's absence. One fresh BrowserContext + own Clerk user per test; serial.

**Harmless noise:** `[reqfail] ... net::ERR_ABORTED` on `/api/...` are in-flight requests cancelled by
navigation/reload, not failures.

**Local→server migration spec (`local-migration.spec.ts`):** ONE shared BrowserContext/page across both
serial tests so localStorage (legacy `anima_entity_*` + `anima_auth_user`, migration flag
`anima_server_migration_v1`) survives sign-out→sign-in. Init script seeds local data ONLY while the
migration flag is unset. Test 1: account A first sign-in → poll flag === "1" → custom char now server-side;
starter roster absent (seeding skips non-empty accounts). Test 2: account B (same browser) → its own starters
present, A's custom char absent, flag still "1" (migration never re-runs).

**Render-wait gotcha:** after `page.goto("/characters")`, do NOT count headings immediately — the lazy
route is still showing the Suspense "Loading..." fallback, so the count is 0 and an `expect.poll` that
reloads on each tick keeps interrupting before render. Instead navigate once, then
`await expect(heading).toBeVisible({timeout})` per attempt (retry the whole goto only if it times out).
The page's self-write suppression means it won't auto-refresh after async migration/seeding, so a FRESH
navigation (not waiting in place) is what surfaces the newly-written server data.
