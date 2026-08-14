---
name: api-server boot env & route-mounting regression
description: Durable invariants that keep the api-server publishable on Replit autoscale (boot env, whole app.ts, @clerk/express v2 auth).
---

# api-server deploy invariants

Deployed on **Replit autoscale** (`anima-protocol.replit.app`), NOT Vercel:
runs `node dist/index.mjs` (esbuild bundle), `NODE_ENV=production`, startup
health probe at `/api/healthz`. The `api/` dir (vercel.mjs) and
`clerkMultiDomainMiddleware` are Vercel-only and irrelevant to this deploy.

## Boot must never hard-require optional env
**Rule:** never assert an env var at boot unless the server cannot serve *any*
request without it. Prod has `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
`DATABASE_URL` but **lacks `CLERK_WEBHOOK_SECRET`**.
**Why:** a hard-require on a webhook-only secret crashes the process on every
autoscale boot → publish never goes live. The webhook route must degrade to an
early 503 when its secret is missing, not crash.

## app.ts is the single route-mounting authority — keep it whole
**Rule:** all routers (`routes/index.ts` barrel + `routes/health.ts`) must stay
mounted in `app.ts`. After any app.ts edit, smoke-test: `/api/healthz` 200,
`/api/store/*` 401 (not 404), webhook 503.
**Why:** a "syntax fixes" spree once amputated app.ts to a stub mounting only the
webhook + an inline health route, so `/api/healthz` 404'd and the autoscale
startup probe failed. If a route file has a bad import, fix the import — never
remove the route from app.ts to make the build pass.

## @clerk/express v2: getAuth(req), not ClerkExpressRequireAuth / req.auth
**Rule:** `ClerkExpressRequireAuth` was removed in v2; importing it breaks the
esbuild build. Use `const { userId } = getAuth(req)` in a `requireUser` guard,
relying on the global `clerkMiddleware()` in app.ts. Every router (store, chat,
openai, storage) must use this same pattern.
**Why:** store.ts reading `req.auth?.userId` works at runtime but fails the
integration tests, which mock `@clerk/express` to export only `getAuth`
(reading an `x-test-user` header). Consistency across routers = tests pass.

## Known pre-existing failure (out of scope)
`test/clerkMultiDomainMiddleware.test.ts` fails because v2 `getAuth` rejects the
hand-rolled signed-out `req.auth` that middleware attaches. That middleware is
Vercel-only and **not mounted in app.ts**, so it cannot affect the Replit
deploy. Fix only if Vercel custom-domain auth is revived.
