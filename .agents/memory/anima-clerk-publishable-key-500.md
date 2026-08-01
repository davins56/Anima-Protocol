---
name: Clerk publishable key 500s all store routes
description: Invalid CLERK_PUBLISHABLE_KEY makes clerkMiddleware throw before requireUser, turning character loads into 500s
---

# Clerk publishable key must be valid on the API

**Symptom:** `GET /api/store/Character` (and every route behind `clerkMiddleware`) returns
`{"error":"Internal server error"}` (HTTP 500). `/api/healthz` still returns 200 because
health is mounted *before* Clerk.

**Cause:** `@clerk/express` `clerkMiddleware()` calls `assertValidPublishableKey` and
throws `Publishable key not valid.` when `CLERK_PUBLISHABLE_KEY` is missing, empty, or
not a parseable `pk_test_`/`pk_live_` key. That runs before store `requireUser`, so a
`getAuth()` try/catch alone cannot prevent the 500.

**Rule:** Never mount bare `clerkMiddleware()` without a safety net. Use
`safeClerkMiddleware()` from `artifacts/api-server/src/middlewares/clerkAuthFallback.ts`
(config errors → 503; other failures → branded signed-out auth → 401).

**Ops check after deploy:**
```bash
curl -s -o /dev/null -w "%{http_code}" https://www.anima-protocol.com/api/store/Character
# 401 = auth OK (signed out); 503 = keys still wrong; 500 = regression
```

`CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` must be the same valid key from
the same Clerk instance as `CLERK_SECRET_KEY`. A blocked Vercel account will keep an old
broken deploy live even after the code fix merges.

**Custom domain fallback:** Production FAPI is `clerk.anima-protocol.com` (apex-derived
`pk_live_`). If `CLERK_PUBLISHABLE_KEY` is missing/invalid, `safeClerkMiddleware` derives
that apex key via `resolveRuntimePublishableKey` so store routes return **401** instead of
**503**. Do not use `publishableKeyFromHost("www.anima-protocol.com")` — that yields the
wrong `clerk.www.*` host.
