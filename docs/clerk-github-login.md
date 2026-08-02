# Clerk Google, GitHub, and Apple login setup

Use this checklist when Google/Gmail, GitHub, or Apple sign-in is unavailable on
`www.anima-protocol.com` or on a Vercel preview deployment.

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

The frontend must pass **relative** paths to Clerk `signIn.sso()` (not absolute
`https://…` URLs). With the custom-domain publishable key, Clerk talks to
`clerk.anima-protocol.com` directly (no `/api/__clerk` proxy):

| Piece | Location | Expected value |
|-------|----------|----------------|
| OAuth redirect paths | `artifacts/anima-protocol/src/lib/clerkOAuthPaths.js` | `/sign-in/sso-callback`, `/sign-up/sso-callback` |
| Clerk proxy | `artifacts/anima-protocol/src/lib/clerkProxy.js` | empty on production custom domain; `/api/__clerk/` only when no custom FAPI host |
| Provider OAuth callback | derived from publishable key | `https://clerk.anima-protocol.com/v1/oauth_callback` |
| SSO routes | `artifacts/anima-protocol/src/App.full.jsx` | `/sign-in/sso-callback`, `/sign-up/sso-callback`, `/sso-callback` |

Absolute app URLs in `signIn.sso()` cause Clerk validation errors such as
*"The string did not match the expected pattern"* and prevent redirects.

## 1. Fix Vercel production keys

In Vercel Project Settings -> Environment Variables -> Production:

- `CLERK_SECRET_KEY`: Clerk Production secret key, `sk_live_...`
- `CLERK_PUBLISHABLE_KEY`: matching Clerk Production publishable key, `pk_live_...`
- `VITE_CLERK_PUBLISHABLE_KEY`: same `pk_live_...` value
- `VITE_CLERK_PROXY_URL`: leave empty (custom domain — do not force proxy)

Redeploy without build cache after changing these values.

## 2. Give Google OAuth keys to Clerk

In Clerk Dashboard -> Production -> Configure -> SSO connections:

1. Add or open the **Google** connection.
2. Enable it for all users.
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

Clerk does **not** support wildcard redirect URLs. Every preview host needs its
own entries in **Clerk Dashboard → Paths → Redirect URLs** (Production for
`pk_live_`, Development for `pk_test_`).

For each preview URL (example:
`https://anima-protocol-abc123-anima-protocol1.vercel.app`), add **both**:

- `https://<preview-host>/sign-in/sso-callback`
- `https://<preview-host>/sign-up/sso-callback`

These are **app** callbacks (Clerk → your preview). Provider OAuth apps still use
the Clerk FAPI callback from the instance’s publishable key / SSO page.

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
Development instance (easier to iterate; shared Google credentials, no custom
provider redirect URI).

Preview builds need `CLERK_SECRET_KEY` as `sk_*` (never `pk_*`). After changing
env vars, redeploy **without build cache**.

If **Vercel Deployment Protection** is enabled on previews, OAuth callbacks to
`/sign-in/sso-callback` may be blocked — disable protection for preview or test
on `www.anima-protocol.com` instead.

## 6. Apple (required if the Apple button is shown)

In Clerk Dashboard → Production (or Development) → Configure → SSO connections:

1. Enable **Apple**.
2. Follow Clerk’s Apple setup wizard (Services ID, Team ID, Key ID, `.p8` key).
3. Production **must** use custom credentials — an empty Services ID / client ID
   produces `invalid_request` / “Invalid OAuth Client Request” on
   `appleid.apple.com` with `client_id=` blank in the authorize URL.
4. Add Clerk’s Authorized Redirect URI
   (`https://clerk.anima-protocol.com/v1/oauth_callback`) as an Apple Return URL.
5. Keep `/sign-in/sso-callback` / `/sign-up/sso-callback` registered under Clerk → Paths.

If Apple is not ready, disable the Apple SSO connection in Clerk (or set
`VITE_CLERK_OAUTH_STRATEGIES=oauth_google,oauth_github`) so the broken button
is hidden.

## 7. Troubleshooting live errors on www.anima-protocol.com

| Symptom | Cause | Fix |
|---------|--------|-----|
| Toast: **The string did not match the expected pattern** on `*.vercel.app` | Preview/unique deploy callback not in Clerk Paths, and/or Vercel Deployment Protection | Use **https://www.anima-protocol.com/sign-in**, or register that host’s `/sign-in/sso-callback` and disable Deployment Protection for Preview |
| Google **Error 400: redirect_uri_mismatch** | Google OAuth client missing Clerk FAPI callback | In Google Cloud Console → Credentials → the OAuth client Clerk uses (Clerk → SSO → Google shows the Client ID; also exposed as `google_one_tap_client_id` in `/v1/environment`) → Authorized redirect URIs → add `https://clerk.anima-protocol.com/v1/oauth_callback` |
| Apple **invalid_request** / empty `client_id=` | Apple enabled in Clerk without Services ID credentials | Clerk → Production → SSO → Apple → set custom credentials, or disable Apple until ready |
| Email/password “tries but doesn’t work” | Production email first factor is **email_code**, not password | Enter the emailed one-time code, or enable Password under Clerk → User & authentication |
| GitHub reaches `github.com/login` | Callback is correct | Complete sign-in; if it fails after authorize, check Clerk → Paths still lists `…/sign-in/sso-callback` |

Do **not** put `/sign-in/sso-callback` into Google/GitHub/Apple — that only belongs
in Clerk → Paths.

## 8. Verify

Run from the repo root with the production Clerk keys in the environment:

```bash
pnpm --filter @workspace/scripts run verify:clerk-oauth -- --fix-redirects
```

Then verify Clerk + API health:

```bash
curl https://www.anima-protocol.com/api/healthz
curl https://clerk.anima-protocol.com/v1/environment
```

Both must return `200`. Production with the custom domain does **not** require
`/api/__clerk` to succeed — the browser talks to `clerk.anima-protocol.com`
directly.

## Production checklist (dashboard only — do not commit secrets)

| Item | Where | Value |
|------|--------|--------|
| Secret key | Vercel Production | `CLERK_SECRET_KEY` = `sk_live_*` (**not** `pk_*`) |
| Publishable keys | Vercel Production + build | `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` = matching `pk_live_*` |
| Proxy env | Vercel | `VITE_CLERK_PROXY_URL` empty (custom domain skips `/api/__clerk`) |
| SSO providers | Clerk Production → SSO connections | Google + GitHub + Apple with **custom** OAuth credentials |
| Provider redirect URI | Google / GitHub / Apple OAuth apps | `https://clerk.anima-protocol.com/v1/oauth_callback` |
| App redirect URLs | Clerk → Paths | `…/sign-in/sso-callback` and `…/sign-up/sso-callback` per host |

Deploying app code alone cannot fix `redirect_uri_mismatch` or an empty Apple
`client_id` — those live in Google Cloud / Apple Developer / Clerk SSO settings.
