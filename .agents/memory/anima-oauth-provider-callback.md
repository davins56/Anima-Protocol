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
