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

The script fails unless **both** HTTP probes succeed (a callback-only
303 can hide a broken `/v1/environment` origin).

Expect:

| Probe | After cutover |
| --- | --- |
| `dig +short clerk.anima-protocol.com CNAME` | **not** `frontend-api.clerk.services` |
| `GET /v1/oauth_callback` (no code) | **303** `https://anima-protocol.com/sign-in?clerk_error=` |
| `GET /v1/environment` | **200** Clerk environment JSON (`auth_config` / `display_config`) |

GitHub OAuth App callback stays
`https://clerk.anima-protocol.com/v1/oauth_callback`.
