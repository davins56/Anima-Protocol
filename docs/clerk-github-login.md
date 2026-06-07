# Clerk GitHub login setup

Use this checklist when GitHub sign-in is unavailable on `www.anima-protocol.com`.

## 1. Fix Vercel production keys

In Vercel Project Settings -> Environment Variables -> Production:

- `CLERK_SECRET_KEY`: Clerk Production secret key, `sk_live_...`
- `CLERK_PUBLISHABLE_KEY`: matching Clerk Production publishable key, `pk_live_...`
- `VITE_CLERK_PUBLISHABLE_KEY`: same `pk_live_...` value
- `VITE_CLERK_PROXY_URL`: leave empty

Redeploy without build cache after changing these values.

## 2. Give GitHub OAuth keys to Clerk

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

## 3. Verify

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
