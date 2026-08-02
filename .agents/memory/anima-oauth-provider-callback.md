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

Helper: `clerkProviderOAuthCallbackUrl` in
`artifacts/anima-protocol/src/lib/clerkProxy.js`. Checklist:
`docs/clerk-github-login.md`.
