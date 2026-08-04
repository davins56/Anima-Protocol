# Clerk Google, GitHub, and Apple login setup

Use this checklist when Google/Gmail, GitHub, or Apple sign-in is unavailable on
`www.anima-protocol.com` or on a Vercel preview deployment.

<<<<<<< HEAD
## Code requirements (already in the app)

The frontend must pass **relative** paths to Clerk `signIn.sso()` (not absolute
`https://…` URLs) and use a **relative** Clerk proxy URL in `ClerkProvider`:

| Piece | Location | Expected value |
|-------|----------|----------------|
| OAuth redirect paths | `artifacts/anima-protocol/src/lib/clerkOAuthPaths.js` | `/sign-in/sso-callback`, `/sign-up/sso-callback` |
| Clerk proxy | `artifacts/anima-protocol/src/lib/clerkProxy.js` | `/api/__clerk/` on `pk_live_` production hosts |
| SSO routes | `artifacts/anima-protocol/src/App.full.jsx` | `/sign-in/sso-callback`, `/sign-up/sso-callback`, `/sso-callback` |

Absolute URLs cause Clerk validation errors such as *"The string did not match
the expected pattern"* and prevent redirects to Google/GitHub/Apple.
=======
## Two different redirect URLs (do not mix them up)

| URL | Where it belongs | Purpose |
|-----|------------------|---------|
| `https://clerk.anima-protocol.com/v1/oauth_callback` | **Google Cloud / GitHub / Apple** OAuth app settings | Provider → Clerk Frontend API after consent |
| `https://www.anima-protocol.com/sign-in/sso-callback` | **Clerk Dashboard → Paths → Redirect URLs** | Clerk → Anima app after OAuth finishes |

Production uses a Clerk **custom domain** (`clerk.anima-protocol.com`). Google’s
`redirect_uri_mismatch` almost always means the provider app is missing
`https://clerk.anima-protocol.com/v1/oauth_callback`. Putting
`/sign-in/sso-callback` in Google/GitHub/Apple **will not** fix that error.

Copy the exact **Authorized Redirect URI** shown in Clerk Dashboard → Production →
SSO connections → Google (same value for GitHub/Apple when using the custom domain).

## Code requirements (already in the app)

Sign-in uses a custom **email OTP** form (`EmailCodeSignIn`) plus GitHub via
Clerk Future `signIn.sso()` (relative redirect paths from `clerkOAuthPaths`).
Do **not** call `clerk.authenticateWithRedirect` — that method is not on the
LoadedClerk object in `@clerk/react` v6 and throws
`authenticateWithRedirect is not a function`. Production Clerk also enables
magic links (`email_link`); the prebuilt UI often chose that after Continue,
then sat on “Check your email” forever if the link was opened on another
device/browser. Forcing `email_code` avoids that hang. With the custom-domain
publishable key, Clerk talks to `clerk.anima-protocol.com` directly
(no `/api/__clerk` proxy):

| Piece | Location | Expected value |
|-------|----------|----------------|
| Sign-in UI | `components/auth/EmailCodeSignIn.jsx` | `signIn.sso` GitHub + email verification **code** |
| Sign-up UI | Clerk `<SignUp>` (waitlist) | Built-in Clerk form |
| Clerk proxy | `artifacts/anima-protocol/src/lib/clerkProxy.js` | empty on production custom domain; `/api/__clerk/` only when no custom FAPI host |
| Provider OAuth callback | derived from publishable key | `https://clerk.anima-protocol.com/v1/oauth_callback` |
| SSO routes | `artifacts/anima-protocol/src/App.full.jsx` | `/sign-in/sso-callback`, `/sign-up/sso-callback`, `/sso-callback` |

**Use https://www.anima-protocol.com/sign-in** for GitHub login. Protected
`*.vercel.app` preview URLs block OAuth callbacks (Vercel Deployment Protection)
and often show false “Clerk SDK did not finish loading” warnings.
>>>>>>> origin/main

## 1. Fix Vercel production keys

In Vercel Project Settings -> Environment Variables -> Production:

- `CLERK_SECRET_KEY`: Clerk Production secret key, `sk_live_...`
- `CLERK_PUBLISHABLE_KEY`: matching Clerk Production publishable key, `pk_live_...`
- `VITE_CLERK_PUBLISHABLE_KEY`: same `pk_live_...` value
<<<<<<< HEAD
- `VITE_CLERK_PROXY_URL`: leave empty
=======
- `VITE_CLERK_PROXY_URL`: leave empty (custom domain — do not force proxy)
>>>>>>> origin/main

Redeploy without build cache after changing these values.

## 2. Give Google OAuth keys to Clerk

<<<<<<< HEAD
In Google Cloud Console, create or open the OAuth client used for Anima Protocol:

- Application type: Web application
- Authorized JavaScript origin: `https://www.anima-protocol.com`
- Authorized redirect URI: `https://www.anima-protocol.com/sign-in/sso-callback`

Copy the Google OAuth **Client ID** and **Client Secret**.

=======
>>>>>>> origin/main
In Clerk Dashboard -> Production -> Configure -> SSO connections:

1. Add or open the **Google** connection.
2. Enable it for all users.
<<<<<<< HEAD
3. Turn on custom credentials if Clerk asks for production credentials.
4. Paste the Google OAuth Client ID and Client Secret.
5. Save.

## 3. Give GitHub OAuth keys to Clerk

In GitHub, create or open the OAuth App used for Anima Protocol:

- Homepage URL: `https://www.anima-protocol.com`
- Authorization callback URL: `https://www.anima-protocol.com/sign-in/sso-callback`

Copy the GitHub OAuth **Client ID** and **Client Secret**.

In Clerk Dashboard -> Production -> Configure -> SSO connections:

1. Add or open the **GitHub** connection.
2. Enable it for all users.
3. Turn on custom credentials.
4. Paste the GitHub OAuth Client ID and Client Secret.
5. Save.

## 4. Vercel preview deployments (`*.vercel.app`)
=======
3. Turn on custom credentials.
4. Copy the **Authorized Redirect URI** Clerk shows (must be
   `https://clerk.anima-protocol.com/v1/oauth_callback` for this project).

In Google Cloud Console, create or open the OAuth client used for Anima Protocol:

- Application type: Web application
- Authorized JavaScript origins:
  - `https://www.anima-protocol.com`
  - `https://anima-protocol.com`
- Authorized redirect URI:
  - `https://clerk.anima-protocol.com/v1/oauth_callback`

Copy the Google OAuth **Client ID** and **Client Secret**, paste them into Clerk,
and save.

## 3. Give GitHub OAuth keys to Clerk

In Clerk Dashboard -> Production -> SSO connections, open **GitHub** and copy the
same Authorized Redirect URI (`https://clerk.anima-protocol.com/v1/oauth_callback`).

In GitHub, create or open the OAuth App used for Anima Protocol:

- Homepage URL: `https://www.anima-protocol.com`
- Authorization callback URL: `https://clerk.anima-protocol.com/v1/oauth_callback`

Copy the GitHub OAuth **Client ID** and **Client Secret**, paste them into Clerk,
and save.

## 4. Email sign-in (code vs password)

Production currently exposes **email verification code** as the email first
factor (`user_settings.attributes.email_address.first_factors: ["email_code"]`),
even though `preferred_sign_in_strategy` is `password`. That means the Sign-in
form asks for a **code from email**, not a password — password attempts will
look like “it tries but doesn’t work.”

To enable email + password sign-in:

1. Clerk Dashboard → **Production** → User & authentication
2. Email → enable **Sign in with email**
3. **Password** tab → enable password for sign-up / sign-in
4. Ensure password is offered as a sign-in first factor (not email-code only)

Until then, users must complete the emailed one-time code, or use a working
OAuth provider.

## 5. Vercel preview deployments (`*.vercel.app`)

**Prefer https://www.anima-protocol.com/sign-in.** Unique deploy URLs
(`*.vercel.app`) often have **Vercel Deployment Protection** (SSO redirect to
`vercel.com/sso-api`), which blocks Clerk OAuth callbacks and breaks email
login. The app toast “The string did not match the expected pattern” on those
hosts usually means the preview callback URL was not in Clerk → Paths yet.
>>>>>>> origin/main

Clerk does **not** support wildcard redirect URLs. Every preview host needs its
own entries in **Clerk Dashboard → Paths → Redirect URLs** (Production for
`pk_live_`, Development for `pk_test_`).

For each preview URL (example:
`https://anima-protocol-abc123-anima-protocol1.vercel.app`), add **both**:

- `https://<preview-host>/sign-in/sso-callback`
- `https://<preview-host>/sign-up/sso-callback`

<<<<<<< HEAD
=======
These are **app** callbacks (Clerk → your preview). Provider OAuth apps still use
the Clerk FAPI callback from the instance’s publishable key / SSO page.

>>>>>>> origin/main
**Automatic registration:** the API registers `VERCEL_URL` callback URLs on cold
start when `CLERK_SECRET_KEY` is set. Redeploy the preview after merging the
latest API build, or run manually:

```bash
pnpm --filter @workspace/scripts run verify:clerk-oauth -- \
  --fix-redirects \
  --preview-host=anima-protocol-abc123-anima-protocol1.vercel.app
```

**Recommended:** use **`pk_test_` / `sk_test_`** on Vercel **Preview** only and
`pk_live_` / `sk_live_` on **Production**, so preview OAuth uses the Clerk
<<<<<<< HEAD
Development instance (easier to iterate).
=======
Development instance (easier to iterate; shared Google credentials, no custom
provider redirect URI).
>>>>>>> origin/main

Preview builds need `CLERK_SECRET_KEY` as `sk_*` (never `pk_*`). After changing
env vars, redeploy **without build cache**.

If **Vercel Deployment Protection** is enabled on previews, OAuth callbacks to
`/sign-in/sso-callback` may be blocked — disable protection for preview or test
on `www.anima-protocol.com` instead.

<<<<<<< HEAD
Verify the Clerk proxy on the preview host:

```bash
curl https://<preview-host>/api/healthz
curl https://<preview-host>/api/__clerk/v1/environment
```

Both should return `200`. A `503` with `clerk_proxy_invalid_secret` means
`CLERK_SECRET_KEY` is set to a publishable `pk_*` key instead of `sk_*`.

## 5. Apple (optional)
=======
## 6. Sign-in methods that work today (Production)

| Method | Status | Notes |
|--------|--------|-------|
| **GitHub** | Works | Prefer this if the account was created with GitHub |
| **Email verification code** | Works | App forces `email_code` after Continue (not magic link) |
| **Email magic link** | Avoided in app UI | Still enabled in Clerk Dashboard; opening a link on another device left the original tab waiting forever |
| **Google** | Broken until console fix | Live symptom: `Error 400: redirect_uri_mismatch`. Add `https://clerk.anima-protocol.com/v1/oauth_callback` to the Google OAuth client’s Authorized redirect URIs |
| **Apple** | Broken until credentials | Clerk reports empty `client_id` — set Apple custom credentials in Clerk → SSO |
| **Password** | Only if set as a first factor | Production first factors are email_code / email_link / oauth_github — password is enabled but `used_for_first_factor: false` |

Do **not** reintroduce custom `signIn.sso()` “Continue with …” buttons — those hung on “Redirecting…” with no network. Optional ops cleanup: in Clerk Dashboard → User & authentication → Email, disable **Email verification link** so only codes remain instance-wide.

## 7. Password vs email code vs GitHub

Production Clerk may show an identifier-first form (email or username first).
That does **not** mean every account can use a password:

| Symptom | Cause | What to do |
|---------|--------|------------|
| `Couldn't find your account` for a Gmail address | That email is not on the **Production** Clerk instance | Sign in with the username / email that exists there (often the original Hotmail), or use **GitHub** |
| After username, only “Check your email” / OTP — no password field | Account has **no password** (common for GitHub/OAuth signups). Clerk returns `strategy_for_user_invalid` for `password` | Enter the email code, or **Continue with GitHub**. After you’re in, set a password in Clerk account settings if you want password next time |
| Want password for an existing OAuth user | Password never set in Production | Clerk Dashboard → Users → user → **Set password**, or user sets one after OTP/GitHub sign-in |

Sign-up on Production may be **waitlist** mode — a brand-new Gmail signup can be
blocked even when sign-in for an existing username works.

## 8. Apple (optional)
>>>>>>> origin/main

In Clerk Dashboard → Production (or Development) → Configure → SSO connections:

1. Enable **Apple**.
<<<<<<< HEAD
2. Follow Clerk’s Apple setup wizard (Services ID, domain verification).
3. Add the same redirect URLs as above for each host you test on.

## 6. Verify
=======
2. Follow Clerk’s Apple setup wizard (Services ID, Team ID, Key ID, `.p8` key).
3. Production **must** use custom credentials — an empty Services ID / client ID
   produces `invalid_request` / “Invalid OAuth Client Request” on
   `appleid.apple.com` with `client_id=` blank in the authorize URL.
4. Add Clerk’s Authorized Redirect URI
   (`https://clerk.anima-protocol.com/v1/oauth_callback`) as an Apple Return URL.
5. Keep `/sign-in/sso-callback` / `/sign-up/sso-callback` registered under Clerk → Paths.

If Apple is not ready, leave the Apple SSO connection disabled in Clerk. The
current app hides the Apple social button until credentials are ready.

## 9. Troubleshooting live errors on www.anima-protocol.com

| Symptom | Cause | Fix |
|---------|--------|-----|
| Toast / inline: **The string did not match the expected pattern** on `*.vercel.app` | Preview/unique deploy callback not in Clerk Paths, and/or Vercel Deployment Protection (or a stale preview bundle) | Close the preview tab and use **https://www.anima-protocol.com/sign-in**. The app also shows a preview banner with that link. Optionally register that host’s `/sign-in/sso-callback` and disable Deployment Protection for Preview |
| **You're already signed in** / session already exists | Clerk Production uses single-session mode; `/sign-in` was opened while a session cookie is still active | Open **https://www.anima-protocol.com/** (Continue to app), or Sign out on the sign-in screen and try again |
| Google **Error 400: redirect_uri_mismatch** | Google OAuth client missing Clerk FAPI callback | In Google Cloud Console → Credentials → the OAuth client Clerk uses (Clerk → SSO → Google shows the Client ID; also exposed as `google_one_tap_client_id` in `/v1/environment`) → Authorized redirect URIs → add `https://clerk.anima-protocol.com/v1/oauth_callback` |
| Apple **invalid_request** / empty `client_id=` | Apple enabled in Clerk without Services ID credentials | Clerk → Production → SSO → Apple → set custom credentials, or disable Apple until ready |
| Email/password “tries but doesn’t work” | Password is not a Production first factor | Use the emailed one-time **code**, or GitHub |
| Continue → “Check your email” forever | Magic link opened on another device/browser (same-device required) | Use the app’s email **code** flow (current UI), or open the link in the **same** browser tab that started sign-in |
| GitHub reaches `github.com/login` | Callback is correct | Complete sign-in; if it fails after authorize, check Clerk → Paths still lists `…/sign-in/sso-callback` |

Do **not** put `/sign-in/sso-callback` into Google/GitHub/Apple — that only belongs
in Clerk → Paths.

## 10. Verify
>>>>>>> origin/main

Run from the repo root with the production Clerk keys in the environment:

```bash
pnpm --filter @workspace/scripts run verify:clerk-oauth -- --fix-redirects
```

<<<<<<< HEAD
Then verify the proxy:

```bash
curl https://www.anima-protocol.com/api/healthz
curl https://www.anima-protocol.com/api/__clerk/v1/environment
curl -I https://www.anima-protocol.com/api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js
```

All three must return `200`.
=======
Then verify Clerk + API health:

```bash
curl https://www.anima-protocol.com/api/healthz
curl https://clerk.anima-protocol.com/v1/environment
```

Both must return `200`. Production with the custom domain does **not** require
`/api/__clerk` to succeed — the browser talks to `clerk.anima-protocol.com`
directly.
>>>>>>> origin/main

## Production checklist (dashboard only — do not commit secrets)

| Item | Where | Value |
|------|--------|--------|
| Secret key | Vercel Production | `CLERK_SECRET_KEY` = `sk_live_*` (**not** `pk_*`) |
| Publishable keys | Vercel Production + build | `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` = matching `pk_live_*` |
<<<<<<< HEAD
| Proxy env | Vercel | `VITE_CLERK_PROXY_URL` empty (app uses `/api/__clerk/` automatically) |
| SSO providers | Clerk Production → SSO connections | Google + GitHub with **custom** OAuth credentials |
| Redirect URLs | Clerk → Paths | Per host: `…/sign-in/sso-callback` and `…/sign-up/sso-callback` |
| Google OAuth | Google Cloud Console | Authorized origin + redirect for each host |
| GitHub OAuth | GitHub OAuth App | Homepage + callback URL for each host |
=======
| Proxy env | Vercel | `VITE_CLERK_PROXY_URL` empty (custom domain skips `/api/__clerk`) |
| SSO providers | Clerk Production → SSO connections | Google + GitHub + Apple with **custom** OAuth credentials |
| Provider redirect URI | Google / GitHub / Apple OAuth apps | `https://clerk.anima-protocol.com/v1/oauth_callback` |
| App redirect URLs | Clerk → Paths | `…/sign-in/sso-callback` and `…/sign-up/sso-callback` per host |

Deploying app code alone cannot fix `redirect_uri_mismatch` or an empty Apple
`client_id` — those live in Google Cloud / Apple Developer / Clerk SSO settings.
>>>>>>> origin/main
