# Workers Builds: production `wrangler deploy` vs preview `versions upload`

Cloudflare Workers Builds for **anima-protocol**:

| Git ref | Deploy command | Hits GET `/workers/scripts/anima-protocol/deployments`? |
|---------|----------------|-----------------------------------------------------------|
| `main` | `npx wrangler deploy --assets=./dist --compatibility-date=2026-08-14 --name anima-protocol` | Yes — before asset upload |
| PR branches | `npx wrangler versions upload --assets=./dist --compatibility-date=2026-08-14 --name anima-protocol` | No |

Wrangler 4.129+ parses that GET with `jsonc-parser` (`disallowComments: true`). A **200** body that is not strict JSON (truncated payload, invalid escapes, comment trivia) surfaces as:

```
Received a malformed response from the API
GET /accounts/.../workers/scripts/anima-protocol/deployments -> 200 OK
```

and **aborts production deploy** (`Failed: error occurred while running deploy command`). The SPA `pnpm build` can still be green. Preview builds stay green because they never call this endpoint.

That is why PR #401 (`clerk-js` 307 → 200) deployed as a preview version but **main** commit `d9d881b` failed (Workers Build `d2ee859e-8544-4d56-9598-f70cba9e7448`). Production kept returning `worker_api_failure` JSON for `/api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js`.

## Repo guard

`pnpm install` copies `scripts/cloudflare/wrangler-deployments-guard.cjs` next to wrangler's bin and injects `node --require`. On GET `/deployments` parse failure the guard:

1. Retries with `JSON.parse` (recovers valid JSON that jsonc-parser rejected).
2. Otherwise continues deploy with an empty deployments list (the GET is only an overwrite warning for gradual rollouts).

Do not remove `api/index.mjs`. Do not put secret values in this file or `wrangler.jsonc`.
