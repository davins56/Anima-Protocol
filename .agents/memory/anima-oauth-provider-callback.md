---
name: Anima OAuth provider callback URI
description: Google/GitHub/Apple must allowlist Clerk FAPI /v1/oauth_callback on the custom domain; app SSO paths are separate.
---

# Anima Protocol — OAuth provider redirect URI

Production publishable key decodes to Frontend API host `clerk.anima-protocol.com`.
Social login therefore sends providers:

`https://clerk.anima-protocol.com/v1/oauth_callback`

That URI belongs in **Google Cloud / GitHub / Apple** OAuth app settings.

`https://www.anima-protocol.com/sign-in/sso-callback` belongs only in
**Clerk → Paths → Redirect URLs** (Clerk → app). Putting the app path in Google
causes `Error 400: redirect_uri_mismatch`.

## Live symptoms (2026-08-02)

- **Google:** `Error 400: redirect_uri_mismatch` — request redirect_uri is
  `https://clerk.anima-protocol.com/v1/oauth_callback`. Google client ID is in
  Clerk environment `display_config.google_one_tap_client_id` (also Clerk → SSO → Google).
- **Apple:** `invalid_request` with `client_id=` empty on `appleid.apple.com` —
  Apple SSO enabled without custom Services ID credentials.
- **GitHub:** authorize page loads (callback OK).

Helper: `clerkProviderOAuthCallbackUrl` in
`artifacts/anima-protocol/src/lib/clerkProxy.js`. Checklist:
`docs/clerk-github-login.md`. Verify:
`pnpm --filter @workspace/scripts run verify:clerk-oauth`.

## Live symptoms (2026-08-03)

- Custom top “Continue with …” buttons (`signIn.sso`) hung on “Redirecting…”
  with **no network** — removed; use Clerk built-in social icons only.
- Clerk built-in **GitHub** works; **Google** still `redirect_uri_mismatch`
  until Google Cloud allowlists the FAPI callback above.
- Production account `Davins56` / `davins56@hotmail.com` has **no password**
  (`strategy_for_user_invalid`) — use email code or GitHub.

## Working login paths (until Google Cloud is fixed)

1. **GitHub** on `https://www.anima-protocol.com/sign-in`
2. **Email/username + emailed verification code** (not password, unless one is set)

Google and Apple buttons are CSS-hidden in `App.full.jsx` so users are not
sent into hard provider failures. Unhide after:

- Google Cloud redirects include `https://clerk.anima-protocol.com/v1/oauth_callback`
- Apple Services ID credentials exist in Clerk Production SSO
