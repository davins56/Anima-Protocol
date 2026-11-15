# Security headers and HTTPS

Security audit 2026-11-14, finding H2. Source of truth:
`artifacts/api-server/src/lib/securityHeaders.ts`.

| Where | What |
|---|---|
| `artifacts/anima-protocol/public/_headers` (`/*`) | Document headers on everything Cloudflare Workers Assets serves directly (HTML, SPA fallback, icons). Must match `DOCUMENT_SECURITY_HEADERS`; `test/securityHeaders.test.ts` enforces it. |
| Express `securityHeadersMiddleware` | API headers on every `/api/*` response (Worker and Node). The Clerk proxy (`/api/__clerk`) gets transport headers only. |
| `worker.ts` | http → https (301 GET/HEAD, 308 otherwise; loopback skipped for `wrangler dev`), plus the headers on `/assets/*` and on the Worker's own API error/timeout responses. |

Headers:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (no `preload`).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`.
- `Permissions-Policy`: microphone, geolocation and motion sensors for the app itself; camera, payment, USB, etc. off.
- API: enforced `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; …`.
- Documents: **`Content-Security-Policy-Report-Only`**. Reports go to `POST /api/csp-report` (logged as "CSP report-only violation", query strings stripped). Enforce it only after the reports are clean; the inline theme script in `index.html` will need a hash instead of `'unsafe-inline'`.

## Operator follow-ups (not in code)

- Cloudflare zone → SSL/TLS → Edge Certificates → **Always Use HTTPS**. Paths not in `run_worker_first` (HTML documents) are served by Assets without running the Worker, so only the zone setting redirects those on a first plain-http visit. Zone changes need Dàvīn's OK.
- `includeSubDomains`: every `*.anima-protocol.com` host must serve HTTPS (clerk, www, llm tunnels all do via Cloudflare today). Drop it from `HSTS_VALUE` and `_headers` first if any subdomain must stay on plain http.
