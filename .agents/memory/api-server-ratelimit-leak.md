---
name: api-server rate-limit leak
description: Why path-less mounted Express sub-routers leak their top-level rateLimit middleware onto all /api routes
---

# Rate limiter leaks from path-less sub-routers

Some api-server routers (e.g. elevenlabs, characterImage) are mounted WITHOUT a
path prefix in `routes/index.ts` (`router.use(elevenLabsRouter)`). If such a
router calls `router.use(rateLimit)` at its top level, that middleware runs for
EVERY request flowing through the parent `/api` router — including unrelated
routes like `/api/store/*` mounted after it — because Express runs a path-less
sub-router's middleware for all requests before checking whether any of its own
routes match.

**Symptom:** unrelated high-traffic endpoints (the new /api/store sync layer)
start returning 429 `{"error":"Too many requests. Please slow down."}` even
though they never opted into rate limiting. Each request can be counted multiple
times (once per leaking router).

**Fix:** scope the limiter to the router's own paths, e.g.
`router.use(["/tts","/voices"], rateLimit)` and
`router.use("/character-image", rateLimit)`. Routers mounted WITH a prefix
(`router.use("/openai", openaiRouter)`) don't leak — their middleware only runs
under that prefix.

**Why it matters:** the limiter is per-IP at 30/min. In dev all requests share
one IP, so any chatty client trips it instantly once the leak is present.
