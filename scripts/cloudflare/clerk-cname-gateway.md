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

`custom_domain: true` stays in root `wrangler.jsonc`. Any later successful
`npx wrangler deploy` of Worker **anima-protocol** re-applies it. The
#421 main build (`92718b9`) was **skipped**; #423 (`14dd27f`) deployed
and attached the host. If public DNS is already apex A records
(`104.21.8.130` / `172.67.157.94`), do **not** add the Custom Domain
again and do **not** recreate a Clerk CNAME.

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

`GET /v1/environment` must not fetch `clerk.anima-protocol.com` (this
Worker). That 522s after Custom Domain attach. The gateway proxies
environment to `https://frontend-api.clerk.dev` with official
`Clerk-Proxy-Url` / `Clerk-Secret-Key`. Bare `/v1/oauth_callback` still
303s locally and never hits Clerk.
