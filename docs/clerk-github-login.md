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

## 4. Vercel preview deployments (`*.vercel.app`)

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

## 5. Apple (optional)

In Clerk Dashboard → Production (or Development) → Configure → SSO connections:

1. Enable **Apple**.
2. Follow Clerk’s Apple setup wizard (Services ID, domain verification).
3. Add Clerk’s Authorized Redirect URI
   (`https://clerk.anima-protocol.com/v1/oauth_callback`) as an Apple Return URL.
4. Keep `/sign-in/sso-callback` / `/sign-up/sso-callback` registered under Clerk → Paths.

## 6. Password vs email code vs GitHub

Production Clerk may show an identifier-first form (email or username first).
That does **not** mean every account can use a password:

| Symptom | Cause | What to do |
|---------|--------|------------|
| `Couldn't find your account` for a Gmail address | That email is not on the **Production** Clerk instance | Sign in with the username / email that exists there (often the original Hotmail), or use **GitHub** |
| After username, only “Check your email” / OTP — no password field | Account has **no password** (common for GitHub/OAuth signups). Clerk returns `strategy_for_user_invalid` for `password` | Enter the email code, or **Continue with GitHub**. After you’re in, set a password in Clerk account settings if you want password next time |
| Want password for an existing OAuth user | Password never set in Production | Clerk Dashboard → Users → user → **Set password**, or user sets one after OTP/GitHub sign-in |

Sign-up on Production may be **waitlist** mode — a brand-new Gmail signup can be blocked even when sign-in for an existing username works.

## 7. Verify

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
| SSO providers | Clerk Production → SSO connections | Google + GitHub with **custom** OAuth credentials |
| Provider redirect URI | Google / GitHub / Apple OAuth apps | `https://clerk.anima-protocol.com/v1/oauth_callback` |
| App redirect URLs | Clerk → Paths | `…/sign-in/sso-callback` and `…/sign-up/sso-callback` per host |
