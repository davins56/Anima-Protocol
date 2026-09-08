# clerk.anima-protocol.com Worker Custom Domain

GitHub callbacks to `https://clerk.anima-protocol.com/v1/oauth_callback`.
That hostname must be **this** Worker (`anima-protocol` gateway), not
Clerk's grey-cloud CNAME. A wrangler **route** (`clerk…/*` + `zone_name`)
does not steal traffic from a third-party CNAME — live after #420 still
`301 Location: /v1/oauth_callback?err_code=authorization_invalid#` from
Clerk (`x-clerk-instance-id`). Safari then shows the 403 JSON.

Cloudflare **Custom Domain** (`custom_domain: true` in `wrangler.jsonc`)
makes the Worker the origin and creates proxied DNS. You cannot attach a
Custom Domain while a CNAME already exists.

`custom_domain: true` stays in root `wrangler.jsonc` for **both**
`anima-protocol.com` and `clerk.anima-protocol.com`. Any later successful
`npx wrangler deploy` of Worker **anima-protocol** re-applies the list
and **deletes** Custom Domains that are missing. Do **not** list only
clerk — that dropped apex A/AAAA after #421 (#422/#425 deploy logs).
The #421 main build (`92718b9`) was **skipped**; #423 (`14dd27f`)
deployed and attached clerk. If public DNS for **clerk** is already
proxied A records (`104.21.8.130` / `172.67.157.94`), do **not**
recreate a Clerk CNAME. Apex is a separate Custom Domain — see
`scripts/cloudflare/www-redirect.md`.

## Cutover (required before / with the next `wrangler deploy`)

1. Cloudflare dashboard → anima-protocol.com → **DNS** → **Records**.
2. Delete `CNAME clerk` → `frontend-api.clerk.services`
   (or `frontend-api.clerk.dev`). Do **not** orange-cloud it first
   (Error 1014 Cross-User Banned).
3. Deploy Worker `anima-protocol` from root `wrangler.jsonc`
   (`custom_domain` for `clerk.anima-protocol.com`). Cloudflare creates
   the proxied record and cert.
4. Verify:

```bash
pnpm --filter @workspace/scripts run verify:clerk-cname-gateway
```

The command GETs `/v1/oauth_callback` **and** `/v1/environment`. It
fails unless both succeed (a callback-only 303 can hide a broken
environment origin). The 303 `Location` must be the apex
`https://anima-protocol.com/sign-in?clerk_error=authorization_invalid`,
not a relative path or another host.

Expect:

| Probe | After cutover |
| --- | --- |
| `dig +short clerk.anima-protocol.com CNAME` | **not** `frontend-api.clerk.services` |
| `GET /v1/oauth_callback` (no code) | **303** `https://anima-protocol.com/sign-in?clerk_error=` |
| `GET /v1/environment` | **200** Clerk environment JSON (`auth_config` / `display_config`) |

`wrangler.jsonc` must list `/v1` and `/v1/*` in `assets.run_worker_first`.
Without that, Custom Domain traffic is asset-first: SPA `index.html` for
`/v1/oauth_callback` and `/v1/environment` (Worker `fetch` never runs).
After changing that list, purge Cached Assets for
`https://clerk.anima-protocol.com/v1/*` (dashboard → Caching → Custom Purge)
so a prior `cf-cache-status: HIT` HTML body does not stick.

GitHub OAuth App callback stays
`https://clerk.anima-protocol.com/v1/oauth_callback`.

## Dashboard fallback (only if wrangler did not attach the host)

If public DNS is **NXDOMAIN** after the Clerk CNAME is deleted and
Workers Builds skipped or queued the `custom_domain` deploy:

1. Cloudflare dashboard → **Workers & Pages** → Worker **anima-protocol**.
2. **Settings** → **Domains & Routes** → **Add** → **Custom Domain**.
3. Enter `clerk.anima-protocol.com` → **Add Custom Domain**.
4. Confirm DNS Records shows a proxied record for `clerk` (not
   `frontend-api.clerk.services`). Do not re-add the Clerk CNAME.
   Do not orange-cloud a leftover Clerk CNAME (Error 1014).
5. Confirm Worker **Settings** → **Domains & Routes** lists
   `clerk.anima-protocol.com` as a Custom Domain.
6. Run `pnpm --filter @workspace/scripts run verify:clerk-cname-gateway`.

If the Custom Domain is already attached but `/v1/*` is HTML, the gap is
`run_worker_first` (git), not DNS. Purge cache after that deploy.

## Worker → Clerk origin (required after Custom Domain)

`GET /v1/environment` must reach **Clerk**, not this isolate. A
`fetch` whose URL host is still `clerk.anima-protocol.com` is a Custom
Domain self-fetch and Cloudflare returns **522**.

`cf.resolveOverride=worker.clerkprod-cloudflare.net` does **not** fix
that:

- Cloudflare ignores `resolveOverride` unless both the URL host and the
  override host are orange-clouded on **this** zone.
- Clerk's SaaS hostname is not on this zone, so the override is dropped
  and the Worker fetches itself (522).
- Connecting to Clerk's anycast IPs with SNI `clerk.anima-protocol.com`
  also lands on this Custom Domain (same 522 page).

`frontend-api.clerk.services` has no public certificate for its own
name (TLS handshake failure). Setting `Host: clerk.anima-protocol.com`
on `frontend-api.clerk.dev` is a Cloudflare **403** (Host/SNI mismatch).

The Worker therefore rewrites the upstream URL to
`https://frontend-api.clerk.dev` (path and query unchanged), **deletes
Host**, and sends Clerk's official path-proxy headers:

- `Clerk-Proxy-Url: https://anima-protocol.com/api/__clerk/`
- `Clerk-Secret-Key` (not on `/npm/*`)
- `X-Forwarded-For` from `CF-Connecting-IP`

`GET /v1/oauth_callback` without `code` still **303s locally** and never
hits Clerk.

This instance is CNAME-only (`proxy_url` is null). `frontend-api.clerk.dev`
returns `host_invalid` until Clerk Dashboard → Domains → **Set proxy
configuration** is `https://anima-protocol.com/api/__clerk`. Deploy this
Worker first (so `/api/__clerk` already forwards to `frontend-api.clerk.dev`),
then set that proxy URL. Do not put `sk_` in git.

## Live verify (after deploy + proxy URL)

```bash
# oauth_callback must stay on the gateway (no Clerk 301 err_code)
curl -sI "https://clerk.anima-protocol.com/v1/oauth_callback"
# expect: HTTP/2 303
#         location: https://anima-protocol.com/sign-in?clerk_error=authorization_invalid

# environment must be Clerk JSON, not 522 HTML
curl -sS -D - -o /tmp/clerk-env.json \
  "https://clerk.anima-protocol.com/v1/environment"
# expect: HTTP/2 200 and auth_config in the body
python3 -c 'import json; d=json.load(open("/tmp/clerk-env.json")); assert "auth_config" in d'

pnpm --filter @workspace/scripts run verify:clerk-cname-gateway
```
