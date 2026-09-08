# www → apex on anima-protocol.com

Production www is **not** Vercel and **not** Worker `anima-protocol` until a
zone Redirect Rule is fixed. `vercel.json` already has a path-preserving
redirect (`https://anima-protocol.com/:path*`). Apex is Workers + Assets.
www never hits that Vercel rule.

## Apex Custom Domain (must stay in `wrangler.jsonc` `routes`)

Worker `anima-protocol` is the origin for **`anima-protocol.com`**. That
hostname **MUST** stay in root `wrangler.jsonc` `routes` as
`{ "pattern": "anima-protocol.com", "custom_domain": true }` **alongside**
`clerk.anima-protocol.com`. Do **not** list only clerk.

`wrangler deploy` treats `routes` as the source of truth. A deploy that
omits apex deletes the dashboard Custom Domain and its proxied A/AAAA —
public DNS then has no apex records (DoH SOA only). That is the #421 →
#422/#425 outage: deploy logs showed only
`clerk.anima-protocol.com (custom domain)`; www still resolved and 301'd
to an unresolvable apex.

Do **not** add `www.anima-protocol.com` as a Custom Domain. The zone
Redirect Rule owns www → apex.

After merge + Workers Build on main, the deploy log must list **both**:

```
anima-protocol.com (custom domain)
clerk.anima-protocol.com (custom domain)
```

Verify:

```bash
# DoH — apex must have A (and usually AAAA), not SOA-only
curl -sS 'https://cloudflare-dns.com/dns-query?name=anima-protocol.com&type=A' \
  -H 'accept: application/dns-json'

# Apex serves the SPA
curl -sS -D- -o /tmp/apex.html https://anima-protocol.com/
# expect HTTP/2 200 and <!DOCTYPE html> (Vite SPA)

# www still 301s to apex (zone rule; path may be dropped until ${1} is fixed)
curl -sSI https://www.anima-protocol.com/
# expect 301 Location: https://anima-protocol.com/  (or /${1} after the fix)
```

## Live zone rule (do not put secrets here)

Cloudflare zone **Redirect Rules**, one active rule, name
**"Redirect www to root"**:

| Field | Value |
| --- | --- |
| Match | URI Full wildcard `https://www.anima-protocol.com/*` |
| Then | 301 `wildcard_replace(http.request.full_uri, r"https://www.anima-protocol.com/*", r"https://anima-protocol.com")` |

The replacement has **no `${1}`**, so `/api/store/Character` 301s to
`https://anima-protocol.com/` (homepage). The 301 body is Cloudflare's own
HTML (`<center>cloudflare</center>`), not the Vite SPA and not Express.

Page Rules are empty. www is **not** a custom domain on Worker
`anima-protocol`. Zone Workers Routes send `*.anima-protocol.com/*` to a
**different** Worker (`anima-protocol-worker`). The Redirect Rule runs first,
so www never reaches either Worker.

Bot Fight Mode is on (free plan). That classic `ie6 oldie` HTML is also
Cloudflare's challenge page. Do not toggle Bot Fight from this repo — `/api/*`
must return JSON on the apex Worker regardless.

## Operator fix (dashboard only)

Change the dynamic replacement to keep the captured path:

```
https://anima-protocol.com/${1}
```

Full expression:

```
wildcard_replace(http.request.full_uri, r"https://www.anima-protocol.com/*", r"https://anima-protocol.com/${1}")
```

After that, `GET https://www.anima-protocol.com/api/store/Character` must 301/308
to `https://anima-protocol.com/api/store/Character`, never `/`.

Do **not** add a `www.anima-protocol.com` route on Worker `anima-protocol`
until this zone rule keeps `${1}`. www is not a custom domain on that Worker;
a wrangler route would not run today and can collide with
`anima-protocol-worker`. `worker.ts` still has a path-preserving 308 helper
if a www request ever reaches this isolate. Do not treat a `vercel.json`
test as a production www test.

Never put origin URLs or passwords in git.
