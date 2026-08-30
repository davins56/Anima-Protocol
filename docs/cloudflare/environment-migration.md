# Cloudflare environment migration

`wrangler.json` intentionally contains only the non-sensitive runtime value `NODE_ENV`. Do not place API keys, database URLs, session secrets, Clerk secrets, or Vite build-time values in this file: it is committed to source control.

## Current status

The configured Worker entry point, `artifacts/api-server/src/worker.ts`, does not exist yet. The existing API is Express and uses Node-oriented libraries, so it must be ported to a Workers-compatible `fetch` handler before `wrangler deploy` can succeed. The static frontend build is configured as a Worker assets directory; API migration is still required before cutover.

## Secret import

Create every listed runtime secret in the Cloudflare dashboard or run the command generated below and paste each value interactively. Do not commit a `.dev.vars` file.

```sh
while IFS= read -r name; do
  [ -z "$name" ] || npx wrangler secret put "$name"
done < scripts/cloudflare/production-secret-names.txt
```

The list is the current runtime-secret inventory from Vercel production/preview. Review unused names before importing. `VITE_CLERK_PUBLISHABLE_KEY` and `BASE_PATH` are frontend build-time inputs; inject them through Cloudflare's build environment. `PORT` is not used by Workers.

## Required migration work before deployment

1. Replace the Express entry with `artifacts/api-server/src/worker.ts` and access bindings through the Worker environment object, not `process.env`.
2. Validate database connectivity with the database provider's Cloudflare-compatible connection path.
3. Move the hourly proactive-message schedule from Vercel Cron to a Worker `scheduled()` handler.
4. Deploy a preview, validate `/api/healthz`, auth, database access, and push notifications, then move the custom domain.
