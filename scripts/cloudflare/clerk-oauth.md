# Clerk production auth on anima-protocol.com

Dashboard-only checklist. Do not put client secrets or `sk_` / `pk_` values
in git.

Production FAPI is the Clerk **custom domain** `clerk.anima-protocol.com`
(CNAME to Clerk). The SPA must talk to Clerk through the same-origin Worker proxy
`/api/__clerk/` (`ClerkProvider proxyUrl`). clerk-js without `proxyUrl` uses
`https://clerk.anima-protocol.com/v1/*` from the publishable key — that
bypasses Worker cookie handling and is the post-GitHub
`authorization_invalid` path. Do not remount ClerkProvider in "direct"
mode on production — if `/api/__clerk` is unhealthy, keep `proxyUrl` and
show an error. Safari ITP would otherwise drop CNAME-cloaked
`__client` cookies. The Worker sets `__client` with
`Domain=anima-protocol.com` so GitHub's top-level hop to
`clerk.anima-protocol.com/v1/oauth_callback` can authenticate (Clerk
ProductionBrowser). Host-only `__client` is **not** sent to that CNAME
and is the clean-attempt `authorization_invalid` path (#406 over-rewrite).
The SPA still expires leftover Domain=apex / Domain=.apex `__client_uat*`
on `/sign-in` and `/sign-up` (before GitHub leaves the page) and again
on the SSO callback page — never `__session` / `__client`, and never on
every app boot. Clerk's CNAME `/v1/oauth_callback` itself Set-Cookies
`__client_uat=0; Domain=anima-protocol.com`. A leftover UAT on the CNAME
hop 301s `authorization_invalid` even when `__client` is present.

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

`authorization_invalid` after **GitHub OAuth** has two CNAME causes,
confirmed live (trace shape matches
`{"errors":[{"code":"authorization_invalid",…}],"clerk_trace_id":…}`
after `301 Location: /v1/oauth_callback?err_code=authorization_invalid#`
→ `403` JSON):

1. **Missing `__client` (clean attempt).** GitHub callbacks to
   `https://clerk.anima-protocol.com/v1/oauth_callback` (CNAME, not this
   Worker). Clerk authenticates that document with the `__client` cookie.
   A host-only `__client` on `anima-protocol.com` is not sent. Live:
   real `__client` + `state` + `code` (no UAT) → `303`
   `/sign-in/sso-callback`. Same request without `__client` → 301/403
   `authorization_invalid`. The Worker therefore Set-Cookies `__client`
   with `Domain=anima-protocol.com`.
2. **Leftover Domain=apex `__client_uat` (retry).** The CNAME plants
   `__client_uat=0; Domain=anima-protocol.com`. Live: valid `__client` +
   leftover UAT → 301/403 `authorization_invalid`. #415 preclears UAT
   on `/sign-in` before `signIn.sso()`.

After a successful callback the SPA lands on
`/sign-in/sso-callback?__clerk_handshake=…` and clerk-js calls
`/api/__clerk/v1/client…`. Clerk may also set `__session` on
`.anima-protocol.com`. Forwarding that orphan `__session` without the
matching `__client` is InvalidAuthorization. The proxy strips
`__session` / `__refresh` / `__client_uat*` on handshake
(`__clerk_handshake` / `/v1/client/handshake`) or when Referer is
`/sign-in/sso-callback` / `/sign-up/sso-callback`. Proxied
`oauth_callback` keeps `__client` and still strips UAT/session.
Ordinary `/v1/client` from `/sign-in` keeps cookies. `__session` /
`__refresh` / `__client_uat*` Set-Cookie stay host-only. Document
redirects stay on the SPA — they are not remapped onto `/api/__clerk/`.

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
- `__client` must be `Domain=anima-protocol.com` so GitHub's document
  callback on `clerk.anima-protocol.com/v1/oauth_callback` receives it.
  Host-only `__client` is the clean-attempt CNAME miss. That Set-Cookie is
  still **first-party**: the Worker writes it on
  `anima-protocol.com/api/__clerk` (Safari ITP).
- The user-visible JSON
  `{ code: "authorization_invalid", clerk_trace_id }` is also returned by
  **proxied** `GET /api/__clerk/v1/oauth_callback?err_code=authorization_invalid`
  (live 403). clerk-js `proxyUrl` + redirect-follow surfaces that as an
  XHR body. Live `curl -L` of `/api/__clerk/v1/oauth_callback` is
  `301 Location: …/api/__clerk/v1/oauth_callback?err_code=` → `403` that
  exact JSON. The Worker must not 301 that hop onto `/api/__clerk` — send
  `/sign-in?clerk_error=` instead — must not fetch Clerk for
  oauth_callback without `code`+`state` (HEAD/GET always 301/403 JSON),
  and must not forward a 401/403 oauth_callback body (303 to `/sign-in`).
  `/v1/client` (orphan session / leftover UAT / SSO Referer) is **200**,
  not this JSON. CNAME `GET /v1/oauth_callback` 301s `err_code` even with
  no cookies or a fake `code` — that hop alone does not prove leftover UAT.
- **Never Domain=apex-expire `__client_uat` from the Worker.** Live
  `HEAD /api/__clerk/v1/oauth_callback` and failed
  `GET /v1/client/handshake` still sent
  `__client_uat=; Domain=anima-protocol.com; Max-Age=0`. #414
  skip-when-minting does not apply when Clerk does not mint (HEAD 405,
  handshake 400). On apex that Max-Age=0 deletes the host-only UAT
  (Safari/Chrome). SPA #415 still preclears leftover CNAME UAT.
  `__session` / `__refresh` / `__client_uat*` Set-Cookie stay host-only.
- **Do not Domain=apex-expire `__client` / `__session` / `__refresh` /
  `__client_uat*` from the Worker.** On the apex host,
  `Set-Cookie: name=; Domain=anima-protocol.com; Max-Age=0` also deletes
  the host-only cookie of the same name (Chrome/Safari). That is the
  "signed in until refresh" failure. The SPA expires visible `__client_uat*`
  leftovers on sign-in / sign-up (before GitHub) and on the SSO callback
  page. Omit `Clerk-Secret-Key` on `/v1/oauth_callback`.

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

## iPad Safari retest (after #416 + this Worker deploy)

Safari on iPad has no Chrome DevTools. ITP will drop CNAME-cloaked
`__client` if clerk-js talks to `clerk.anima-protocol.com` directly —
keep `proxyUrl=/api/__clerk/`.

**After #416 (`Domain=apex __client`): clear Website Data before the
first GitHub attempt.** An old **host-only** `__client` (from #406)
is never sent to `clerk.anima-protocol.com/v1/oauth_callback` and is
the clean-attempt `authorization_invalid` path. `/v1/client` remints
`Domain=apex __client` on every load, but Safari can keep the host-only
copy next to it, and a leftover Domain=apex `__client_uat` from a
failed CNAME hop still 301s `authorization_invalid` even with a valid
`__client`. Clearing both hosts is the reliable first attempt.

1. Settings → Apps → Safari → Advanced → Website Data → remove
   `anima-protocol.com` **and** `clerk.anima-protocol.com`.
2. Open https://anima-protocol.com/sign-in (not www). Wait for the
   GitHub button (clerk-js `/v1/client` must mint Domain=apex `__client`).
3. Continue with GitHub (clean first attempt). Expect GitHub → CNAME
   callback → `/sign-in/sso-callback` → Home. After this deploy you
   must **not** land on JSON `authorization_invalid` / `clerk_trace_id`
   (that was proxied `/api/__clerk/v1/oauth_callback` 403). A return
   to `/sign-in?clerk_error=` means retry GitHub after the wipe.
4. Sign out, open `/sign-in` again, Continue with GitHub (retry).
5. Hard-refresh Home and Settings — identity stays.

Do **not** change the GitHub OAuth App callback. It must stay
`https://clerk.anima-protocol.com/v1/oauth_callback`.
