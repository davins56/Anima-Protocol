# www → apex on anima-protocol.com

Production www is **not** Vercel and **not** Worker `anima-protocol` until a
zone Redirect Rule is fixed. `vercel.json` already has a path-preserving
redirect (`https://anima-protocol.com/:path*`). Apex is Workers + Assets.
www never hits that Vercel rule.

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

`wrangler.jsonc` also declares a `www.anima-protocol.com/*` route on Worker
`anima-protocol` plus a path-preserving 308 in `worker.ts`. Those do **not**
run while this zone rule drops the path. Do not treat a `vercel.json` test as
a production www test.

Never put origin URLs or passwords in git.
