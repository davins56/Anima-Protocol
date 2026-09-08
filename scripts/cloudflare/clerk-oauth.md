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

After deploy, Clerk Dashboard → Domains → **Set proxy** to
`https://anima-protocol.com/api/__clerk` (trailing slash OK). The Worker
forwards `/api/__clerk/v1/proxy-health` to
`https://frontend-api.clerk.dev/v1/proxy-health` with `Clerk-Proxy-Url`,
`Clerk-Secret-Key`, and `X-Forwarded-For`. Verify should pass. Cloudflare
**Bot Fight Mode** may still block Clerk's checker (ops, not code).
Sending official path-proxy headers (`Clerk-Proxy-Url`,
`X-Forwarded-Host`) to an unrewritten `clerk.anima-protocol.com` hop
makes `GET /v1/client` return `host_invalid` — those headers go only to
`frontend-api.clerk.dev`.

Worker-originated FAPI (`/v1/*` after clerk-js loads) must still send
`Clerk-Secret-Key` and `X-Forwarded-For` (from `CF-Connecting-IP`, not
the spoofable leftmost XFF hop; fallback `127.0.0.1` if the IP header
is missing). Do **not** attach the secret to `/npm/*` hops — those 307
to jsDelivr.

`authorization_invalid` after **GitHub OAuth** is Clerk's CNAME
**document** (address bar `clerk.anima-protocol.com`), not proxied
`/api/__clerk` (#417 already 303s those to `/sign-in?clerk_error=`).
Confirmed live (trace shape matches
`{"errors":[{"code":"authorization_invalid",…}],"clerk_trace_id":…}`
after `301 Location: /v1/oauth_callback?err_code=authorization_invalid#`
→ `403` JSON). #419 (`f413aee`) gets iPad past `needs_identifier` so
GitHub actually leaves; the next hop is this CNAME JSON.

Causes, confirmed live:

1. **Safari ITP CNAME-cloaking (iPad, even after Website Data wipe).**
   DNS is `clerk.anima-protocol.com CNAME frontend-api.clerk.services`
   (visible to the resolver; grey-cloud). ITP hides first-party
   Domain=apex `__client` from that cloaked host. #416 Domain=apex is
   necessary on Chrome and still not sent on iPad Safari. Do **not**
   orange-cloud the Clerk CNAME (Cloudflare Error 1014 Cross-User
   Banned). This Worker binds `clerk.anima-protocol.com/*` and gateways
   to Clerk by rewriting the URL to `https://frontend-api.clerk.dev`
   (official path-proxy headers). Do **not** `fetch` the Custom Domain
   host or use `cf.resolveOverride` — that is the production **522**.
   Safari still sees same-eTLD+1 A records, not a third-party CNAME.
   Failed CNAME hops also plant `__client_uat=0; Domain=apex`; the
   gateway drops those Set-Cookies.
2. **Missing `__client` (clean attempt on browsers without ITP cloaking).**
   Clerk authenticates the document with the `__client` cookie. A
   host-only `__client` on `anima-protocol.com` is not sent. Live:
   real `__client` + `state` + `code` (no UAT) → `303`
   `/sign-in/sso-callback`. Same request without `__client` → 301/403
   `authorization_invalid`. The Worker therefore Set-Cookies `__client`
   with `Domain=anima-protocol.com` and, on `POST /v1/client/sign_ins`,
   stashes `state → __client` so the gateway can inject the token if
   Safari still omits the cookie.
3. **Leftover Domain=apex `__client_uat` (retry).** The CNAME plants
   `__client_uat=0; Domain=anima-protocol.com`. Live: valid `__client` +
   leftover UAT → 301/403 `authorization_invalid`. #415 preclears UAT
   on `/sign-in` before GitHub. #419 leftover `signIn.id` without an
   OAuth URL skips clerk-js `_create` — the SPA now force-creates /
   first-party POSTs `oauth_github` so `state` matches the browser
   `__client` instead of assigning a stale authorize URL.

After a successful callback the SPA lands on
`/sign-in/sso-callback?__clerk_handshake=…` and clerk-js calls
`/api/__clerk/v1/client…`. The proxy strips `__session` / `__refresh` /
`__client_uat*` only on handshake (`__clerk_handshake` /
`/v1/client/handshake`) and on proxied `oauth_callback` (which still
forwards `__client`). Do **not** strip ordinary `/v1/client` just
because Referer is `/sign-in/sso-callback` — that refetch carries the
`__session` handshake just minted; stripping it bounces Safari to
signed-out `/sign-in` (no JSON). Orphan CNAME `__session` on
`/v1/client` is 200, not `authorization_invalid`. `__session` /
`__refresh` / `__client_uat*` Set-Cookie stay host-only. Document
redirects stay on the SPA — they are not remapped onto `/api/__clerk/`.
`Location: /v1/oauth_callback?code=&state=` stays on `/api/__clerk`
(only `err_code` goes to `/sign-in?clerk_error=`).

Verify:

```bash
pnpm --filter @workspace/scripts run verify:clerk-oauth -- --fix-redirects
pnpm --filter @workspace/scripts run verify:clerk-cname-gateway
```

## Worker proxy (code)

- `GET /api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` must return
  **200** `application/javascript`. Clerk’s CDN 307s the `@6` dist-tag to a
  patched version (`@6.31.0`, …). The proxy follows that hop. A 307 without
  `Location` (or JSON `worker_api_failure`) is a regression: browsers refuse
  the script tag.
- `/api/__clerk/v1/*` 3xx with `Location` (GitHub authorize URL, handshake)
  must be forwarded, not rewritten as JSON.
- `clerk.anima-protocol.com` must be a Worker **Custom Domain**
  (`wrangler.jsonc` `custom_domain: true`), not a zone route in front of
  Clerk's CNAME. A route never receives grey-cloud CNAME traffic — live
  after #420 still `301 err_code` from Clerk. Delete
  `CNAME clerk → frontend-api.clerk.services` first, then deploy
  (see `scripts/cloudflare/clerk-cname-gateway.md`). Do not orange-cloud
  the   Clerk CNAME (1014). Upstream is Clerk via URL rewrite to
  `frontend-api.clerk.dev` (not `cf.resolveOverride`).
  GitHub's Authorization callback URL stays
  `https://clerk.anima-protocol.com/v1/oauth_callback`.
- `__client` must be `Domain=anima-protocol.com` so GitHub's document
  callback on `clerk.anima-protocol.com/v1/oauth_callback` receives it
  after the gateway cutover (same eTLD+1, no ITP CNAME cloak). Host-only
  `__client` is the clean-attempt CNAME miss. That Set-Cookie is still
  **first-party**: the Worker writes it on
  `anima-protocol.com/api/__clerk`.
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
  leftovers on sign-in / sign-up **before GitHub** — never on
  `/sign-in/sso-callback` (Domain=apex Max-Age=0 also deletes the
  host-only UAT handshake just minted). Omit `Clerk-Secret-Key` on
  `/v1/oauth_callback`.

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

## iPad Safari retest (after this deploy)

Safari on iPad has no Chrome DevTools. ITP will drop CNAME-cloaked
`__client` if clerk-js talks to `clerk.anima-protocol.com` directly —
keep `proxyUrl=/api/__clerk/`.

**Clear Website Data once** before the first attempt after this
deploy. Leftover Domain=apex `__client_uat` from a failed CNAME hop
still 301s `authorization_invalid` even with a valid `__client`. An
old host-only `__client` is invisible to the CNAME.

1. Settings → Apps → Safari → Advanced → Website Data → remove
   `anima-protocol.com` **and** `clerk.anima-protocol.com`.
2. Open https://anima-protocol.com/sign-in (not www). Wait for
   Continue with GitHub.
3. Continue with GitHub. The page must **leave for GitHub** (not stay
   on `/sign-in` with `needs_identifier` / “did not redirect”). Then
   GitHub → `clerk.anima-protocol.com/v1/oauth_callback` →
   `/sign-in/sso-callback` → **signed-in Home**. The address bar must
   **not** stay on `clerk.anima-protocol.com` showing
   `authorization_invalid` JSON — that document is now 303'd to
   `/sign-in?clerk_error=`. A red `needs_identifier` banner (without
   “must allowlist”) means the SPA still could not assign a GitHub
   URL; tap Continue with GitHub again. `/sign-in?clerk_error=` means
   the gateway hid a failed Clerk hop — wipe both hosts and retry.
   Do **not** change the GitHub OAuth App callback — live FAPI still
   issues `redirect_uri=https://clerk.anima-protocol.com/v1/oauth_callback`.
4. Sign out, `/sign-in`, GitHub retry (no wipe required if step 3
   succeeded).
5. Hard-refresh Home and Settings — identity stays.

Do **not** change the GitHub OAuth App callback. It must stay
`https://clerk.anima-protocol.com/v1/oauth_callback`.
