# Clerk production auth on anima-protocol.com

Dashboard-only checklist. Do not put client secrets or `sk_` / `pk_` values
in git.

Production FAPI is the Clerk **custom domain** `clerk.anima-protocol.com`
(CNAME to Clerk). The SPA still talks to Clerk through the same-origin
Worker proxy `/api/__clerk/` so session cookies are first-party (Safari ITP
would otherwise drop CNAME-cloaked `__client` cookies).

GitHub (and Google) do **not** callback to the SPA. They callback to Clerk.

## GitHub OAuth App (required)

GitHub → Settings → Developer settings → OAuth Apps → the app whose
Client ID is pasted into **Clerk Production → SSO connections → GitHub**.

| Field | Exact value |
| --- | --- |
| Homepage URL | `https://anima-protocol.com` |
| Authorization callback URL | `https://clerk.anima-protocol.com/v1/oauth_callback` |

That callback host is Clerk, not this Worker. `curl -sI` should reach Clerk
(`x-clerk-trace-id`, `allow: POST, GET`). Do **not** put
`https://anima-protocol.com/sign-in/sso-callback` or
`https://anima-protocol.com/api/__clerk/v1/oauth_callback` in the GitHub
OAuth App. Those are app / proxy paths; GitHub never hits them.

If the GitHub App callback is missing or still lists only `accounts.dev`,
GitHub sign-in hangs on `/sign-in` with:

> GitHub sign-in did not redirect. Use https://anima-protocol.com/sign-in.
> If this keeps happening, the GitHub OAuth App must allowlist
> https://clerk.anima-protocol.com/v1/oauth_callback.

## Clerk Dashboard (Production instance)

Same instance as the live `pk_live_` / `sk_live_` pair.

| Surface | Value |
| --- | --- |
| Configure → Domains | Custom Frontend API: `clerk.anima-protocol.com` |
| Configure → SSO connections | GitHub enabled with that GitHub OAuth App |
| Paths → Home URL | `https://anima-protocol.com` |
| Paths → Sign-in | `https://anima-protocol.com/sign-in` |
| Paths → Sign-up | `https://anima-protocol.com/sign-up` |
| Paths → After sign-in / After sign-up | `https://anima-protocol.com` (not `https://clerk.anima-protocol.com`) |
| Paths / Redirects | `https://anima-protocol.com/sign-in/sso-callback` |
| | `https://anima-protocol.com/sign-up/sso-callback` |
| | `https://www.anima-protocol.com/sign-in/sso-callback` |
| | `https://www.anima-protocol.com/sign-up/sso-callback` |

Leave **Proxy URL** empty in the dashboard when using the custom FAPI
domain. The Worker still proxies browser traffic; official
`Clerk-Proxy-Url` headers 400 on a CNAME-only instance.

Verify:

```bash
pnpm --filter @workspace/scripts run verify:clerk-oauth -- --fix-redirects
```

## Worker proxy (code)

- `GET /api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` must return
  **200** `application/javascript`. Clerk’s CDN 307s the `@6` dist-tag to a
  patched version (`@6.31.0`, …). The proxy follows that hop. A 307 without
  `Location` (or JSON `worker_api_failure`) is a regression: browsers refuse
  the script tag.
- `/api/__clerk/v1/*` 3xx with `Location` (GitHub authorize URL, handshake)
  must be forwarded, not rewritten as JSON.
- `clerk.anima-protocol.com` stays on Clerk DNS. Do not point that hostname
  at Worker `anima-protocol`.

Live probes:

```bash
curl -sI "https://anima-protocol.com/api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js"
# expect HTTP 200 and content-type application/javascript

curl -sI "https://clerk.anima-protocol.com/v1/oauth_callback"
# expect Clerk headers; Allow: POST, GET (HEAD may be 405)

curl -s "https://anima-protocol.com/api/healthz/clerk?probe=1"
# expect keyPairing: ok, frontendApiHost: clerk.anima-protocol.com
```
