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
domain. The Worker still proxies browser traffic through
`/api/__clerk/`. This instance is **CNAME-only**:
`frontend-api.clerk.dev` returns `host_invalid` even with a live secret
and `Clerk-Proxy-Url`. Sending official path-proxy headers
(`Clerk-Proxy-Url`, `X-Forwarded-Host`) to `clerk.anima-protocol.com`
makes `GET /v1/client` return `host_invalid`.

Worker-originated FAPI (`/v1/*` after clerk-js loads) must still send
`Clerk-Secret-Key` and `X-Forwarded-For` (from `CF-Connecting-IP`, not
the spoofable leftmost XFF hop). Do **not** attach the secret to
`/npm/*` hops — those 307 to jsDelivr.

`authorization_invalid` after **GitHub OAuth** is a different failure:
GitHub returns to `https://clerk.anima-protocol.com/v1/oauth_callback`
(CNAME, not this Worker). Clerk may set `__session` on
`.anima-protocol.com` while `__client` stays on the CNAME. The SPA then
lands on `/sign-in/sso-callback?__clerk_handshake=…` and clerk-js calls
`/api/__clerk/v1/client…`. Forwarding that orphan `__session` without
the matching `__client` is InvalidAuthorization. Handshake requests
strip `__client` / `__session` / `__refresh` cookies so the handshake
JWT is the only credential; Set-Cookie on the response is rewritten
first-party.

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

curl -s -H "Origin: https://anima-protocol.com" \
  "https://anima-protocol.com/api/__clerk/v1/client?__clerk_api_version=2026-05-12&_clerk_js_version=6.31.0"
# expect HTTP 200 client JSON — not authorization_invalid / host_invalid
```
