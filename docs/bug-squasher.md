# Bug Squasher

Automatic bug capture, a "Report a bug" panel, and an admin triage screen.

## What gets captured

| Kind | Source | Grouped by |
|---|---|---|
| `window_error` | `window` `error` event | normalised message + top stack frame |
| `unhandled_rejection` | `unhandledrejection` event | normalised message + top stack frame |
| `react_crash` | `ErrorBoundary.componentDidCatch` | normalised message + top stack frame |
| `api_error` | any same-origin `/api/*` fetch that returns 5xx or fails at the network | method + id-free path + status |
| `chat_failure` | `reportChatClientFailure` (failed or empty chat SSE turns, `lib/chatClientFailure.js`) | failure type + phase |
| `manual` | the Report a bug panel | normalised description |

Each report carries: route (path + query keys only), app version (`VITE_APP_COMMIT`), browser (UA, language, viewport, standalone), the last 30 breadcrumbs (navigation, API calls, errors, chat failures), recent captured errors, and a timestamp. The user id comes from the Clerk session on the server.

Never attached: chat messages, replies, memories. Every string is scrubbed twice (browser `src/lib/bugSquasher/scrub.js`, server `src/lib/bugSquasher/scrub.ts`): bearer tokens, JWTs, Stripe/OpenAI/OpenRouter/GitHub/Slack/AWS/Google keys, `token=` / `password:`-style pairs, emails, connection strings, data URLs and long opaque ids. Object keys that name a credential are dropped.

Not reported: `ResizeObserver loop` noise, cross-origin `Script error.`, aborts, browser-extension stacks, 4xx responses, and failures of `/api/bug-squasher`, `/api/chat/client-failure`, `/api/__clerk`, `/api/healthz`.

## Dedupe and rate limits

- Browser: one fingerprint is sent at most once a minute; repeats inside that minute are counted and sent as `occurrences`. At most 10 sends a minute and 60 per page load. A 401/403/404/503 pauses sending for 10 minutes, a 429 for one.
- Server: 30 ingests a minute per user; at most 200 *new* bugs per user per day (repeats always count). The fingerprint is recomputed on the server; the client's is never trusted.
- Storage: one row per (user, fingerprint). A repeat bumps `count` and `last_seen`.

## Status and reopening

`new → triaged → fixed | ignored`. The triage screen changes the status of every row with that fingerprint. When a **fixed** bug happens again (same user or anyone else) it goes back to **new**, `reopen_count` goes up and it shows "Reopened" in triage. Ignored bugs stay ignored; triaged bugs stay triaged when a new user hits them.

## Where it lives

- **Report a bug**: Settings → Data & Privacy → Bug Squasher (also "Report this bug" on the crash screen). An optional slim bug tab on the left edge of every screen is on by default for admins and opt-in for everyone else (same card).
- **Triage** (admins): `/bug-squasher`, linked from the same Settings card.
- API: `artifacts/api-server/src/routes/bugSquasher.ts`
  - `POST /api/bug-squasher/reports` (signed-in)
  - `GET /api/bug-squasher/reports/mine`
  - `GET /api/bug-squasher/admin/groups?status=&q=`, `GET|PATCH /api/bug-squasher/admin/groups/:fingerprint`, `GET /api/bug-squasher/admin/reports/:id/screenshot` (admins)

## Setup

1. **Apply the migration** (not applied by deploys or CI):

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261124010000_bug_squasher.sql
   # or, with the Supabase CLI: supabase db push
   ```

   It only creates `bug_reports`, `bug_report_admins` and (on Supabase) `bug_reports_is_admin()` plus RLS policies. It is re-runnable. Until it is applied every route answers `503 bug_squasher_schema_missing` and the browser quietly stops sending.

   Rollback (by hand, only while `bug_reports` is empty): `supabase/rollback/20261124010000_bug_squasher.down.sql`.

2. **Admins**: triage uses the existing server-side role (`lib/accountRole.ts`): the Protocol steward (`PROTOCOL_STEWARD_USER_IDS`), `ANIMA_ADMIN_USER_IDS` (Clerk user ids, preferred) or `ANIMA_ADMIN_EMAILS`. Set one as a Worker var/secret.

3. Optional, direct Supabase access only: `INSERT INTO public.bug_report_admins (user_id) VALUES ('user_…');` lets that Clerk user read/triage every row through RLS. The API does not use this table.

## RLS

RLS is on for both tables. On Supabase (role `authenticated` and `auth.jwt()` present) a user can insert only their own row (status `new`, count 1, no admin note) and read only their own rows; ids in `bug_report_admins` can read everything and update only the status/note columns. Nobody can delete through the client roles; `anon` has no access. The Worker connects as the database owner and enforces the same rules in the route handlers.
