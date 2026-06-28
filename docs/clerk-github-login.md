# Clerk Google, GitHub, and Apple login setup

Use this checklist when Google/Gmail, GitHub, or Apple sign-in is unavailable on
`www.anima-protocol.com` or on a Vercel preview deployment.

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

## 1. Fix Vercel production keys

In Vercel Project Settings -> Environment Variables -> Production:

- `CLERK_SECRET_KEY`: Clerk Production secret key, `sk_live_...`
- `CLERK_PUBLISHABLE_KEY`: matching Clerk Production publishable key, `pk_live_...`
- `VITE_CLERK_PUBLISHABLE_KEY`: same `pk_live_...` value
- `VITE_CLERK_PROXY_URL`: leave empty

Redeploy without build cache after changing these values.

## 2. Give Google OAuth keys to Clerk

In Google Cloud Console, create or open the OAuth client used for Anima Protocol:

- Application type: Web application
- Authorized JavaScript origin: `https://www.anima-protocol.com`
- Authorized redirect URI: `https://www.anima-protocol.com/sign-in/sso-callback`

Copy the Google OAuth **Client ID** and **Client Secret**.

In Clerk Dashboard -> Production -> Configure -> SSO connections:

1. Add or open the **Google** connection.
2. Enable it for all users.
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

Clerk does **not** support wildcard redirect URLs. Every preview host needs its
own entries in **Clerk Dashboard → Paths → Redirect URLs** (Production for
`pk_live_`, Development for `pk_test_`).

For each preview URL (example:
`https://anima-protocol-abc123-anima-protocol1.vercel.app`), add **both**:

- `https://<preview-host>/sign-in/sso-callback`
- `https://<preview-host>/sign-up/sso-callback`

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
Development instance (easier to iterate).

Preview builds need `CLERK_SECRET_KEY` as `sk_*` (never `pk_*`). After changing
env vars, redeploy **without build cache**.

If **Vercel Deployment Protection** is enabled on previews, OAuth callbacks to
`/sign-in/sso-callback` may be blocked — disable protection for preview or test
on `www.anima-protocol.com` instead.

Verify the Clerk proxy on the preview host:

```bash
curl https://<preview-host>/api/healthz
curl https://<preview-host>/api/__clerk/v1/environment
```

Both should return `200`. A `503` with `clerk_proxy_invalid_secret` means
`CLERK_SECRET_KEY` is set to a publishable `pk_*` key instead of `sk_*`.

## 5. Apple (optional)

In Clerk Dashboard → Production (or Development) → Configure → SSO connections:

1. Enable **Apple**.
2. Follow Clerk’s Apple setup wizard (Services ID, domain verification).
3. Add the same redirect URLs as above for each host you test on.

## 6. Verify

Run from the repo root with the production Clerk keys in the environment:

```bash
pnpm --filter @workspace/scripts run verify:clerk-oauth -- --fix-redirects
```

Then verify the proxy:

```bash
curl https://www.anima-protocol.com/api/healthz
curl https://www.anima-protocol.com/api/__clerk/v1/environment
curl -I https://www.anima-protocol.com/api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js
```

All three must return `200`.

## Production checklist (dashboard only — do not commit secrets)

| Item | Where | Value |
|------|--------|--------|
| Secret key | Vercel Production | `CLERK_SECRET_KEY` = `sk_live_*` (**not** `pk_*`) |
| Publishable keys | Vercel Production + build | `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` = matching `pk_live_*` |
| Proxy env | Vercel | `VITE_CLERK_PROXY_URL` empty (app uses `/api/__clerk/` automatically) |
| SSO providers | Clerk Production → SSO connections | Google + GitHub with **custom** OAuth credentials |
| Redirect URLs | Clerk → Paths | Per host: `…/sign-in/sso-callback` and `…/sign-up/sso-callback` |
| Google OAuth | Google Cloud Console | Authorized origin + redirect for each host |
| GitHub OAuth | GitHub OAuth App | Homepage + callback URL for each host |
