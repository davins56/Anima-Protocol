# Calendar awareness (Settings > Day Rhythm)

Companions hold off while the steward is busy. The Worker reads **busy/free
time only** from a connected calendar and feeds it into the rhythm snapshot
the agency tick already uses (`sensesPercept` → `agencyTick` "busy" silence).

## What is read

| Provider | Scope | Call | Fields received |
| --- | --- | --- | --- |
| Google | `https://www.googleapis.com/auth/calendar.freebusy` | `POST /calendar/v3/freeBusy` (primary) | busy `{start, end}` |
| Microsoft | `offline_access`, `Calendars.ReadBasic` (delegated) | `GET /me/calendarView?$select=start,end,showAs,isCancelled` | start, end, showAs |

Microsoft Graph has no narrower delegated scope. `getSchedule` is not
supported for personal Microsoft accounts and returns `subject` for your own
calendar, so `calendarView` with `$select` is used: Graph never returns the
subject, body, location or attendees. Only `busy`, `oof` and `tentative`
count as busy.

## Privacy rules

- Opt-in: nothing happens until the steward presses Connect.
- Latest set only: `user_profiles.data.calendar_busy` = `{receivedAt,
  providers, busy:[{startsAt, endsAt}]}`, overwritten on each sync, ignored
  after 6 hours (same as the device snapshot). Next 48 hours, ≤16 merged blocks.
- Tokens: only the refresh token is stored, in `calendar_connections`,
  AES-256-GCM sealed with `ANIMA_CALENDAR_TOKEN_KEY` and bound to
  user+provider. No access token, email, calendar id or event data is stored.
- Disconnect (`DELETE /api/calendar/:provider`): deletes the row, revokes at
  Google (`oauth2.googleapis.com/revoke`). Microsoft has no per-app revoke
  endpoint; the user can remove the app at https://account.live.com/consent/Manage
  (personal) or https://myapplications.microsoft.com (work/school).
- "Forget my rhythm data" (`DELETE /api/senses`) also disconnects every
  calendar and clears `calendar_busy`.

## When it syncs

- Right after connecting (OAuth callback).
- In the agency tick, when the stored set is missing or older than 30 minutes.
- `POST /api/calendar/sync` (at most every 5 minutes per user).

## Routes

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/calendar` | Clerk |
| POST | `/api/calendar/connect/:provider` → `{url}` | Clerk; sets an HttpOnly SameSite=Lax state cookie |
| GET | `/api/calendar/oauth/:provider/callback` | sealed `state` + matching cookie; redirects to `/settings?section=interface&calendar=<outcome>` |
| POST | `/api/calendar/sync` | Clerk |
| DELETE | `/api/calendar/:provider` | Clerk |

Outcomes: `connected`, `denied`, `scope_missing`, `invalid_state`,
`unavailable`, `error`.

## Configuration (Worker secrets)

| Name | Value |
| --- | --- |
| `ANIMA_KERNEL_SENSES` | `1` (already gates /api/senses) |
| `ANIMA_CALENDAR_TOKEN_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`) |
| `ANIMA_CALENDAR_REDIRECT_ORIGIN` | optional; defaults to `ANIMA_APP_ORIGIN`. e.g. `https://anima-protocol.com` |
| `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` | Google OAuth web client |
| `MICROSOFT_CALENDAR_CLIENT_ID` / `MICROSOFT_CALENDAR_CLIENT_SECRET` | Entra app registration |
| `MICROSOFT_CALENDAR_TENANT` | optional; default `common` |

Redirect URIs: `<origin>/api/calendar/oauth/google/callback` and
`<origin>/api/calendar/oauth/microsoft/callback`.

Migration: `supabase/migrations/20261114020000_calendar_connections.sql`
(applied by hand, like the other protected tables). Until it is applied,
every read treats the missing table as "no connections".
