# Workers Builds: production `wrangler deploy` vs preview `versions upload`

Cloudflare Workers Builds for **anima-protocol** (worker id `b7f2ce9d029e46e8b75741ce999c121d`):

| Git ref | Dashboard deploy command | Informational GETs that can abort wrangler |
|---------|--------------------------|--------------------------------------------|
| `main` | `npx wrangler deploy --assets=./dist --compatibility-date=2026-08-14 --name anima-protocol` | GET `/workers/scripts/anima-protocol/deployments` **before** upload; GET `/workers/subdomain` **after** upload |
| PR branches | `npx wrangler versions upload --assets=./dist --compatibility-date=2026-08-14 --name anima-protocol` | GET `/workers/subdomain` **after** a successful version upload (preview URL) |

Git cannot change those dashboard commands. Pin wrangler in `package.json` and keep the postinstall `--require` guard so the commands that are already configured succeed.

## Did main #401 (`d9d881b`) upload a new production version?

**No.** Workers Build `d2ee859e-8544-4d56-9598-f70cba9e7448` finished `pnpm build`, then wrangler 4.129.1 died on:

```
GET /accounts/.../workers/scripts/anima-protocol/deployments -> 200 OK
Received a malformed response from the API
```

That call is only `confirmLatestDeploymentOverwrite` (gradual-rollout warning). Logs never reached `Building list of assets`. Production kept serving the previous Worker (#400 / `d8916e3`). The PR #401 preview (`versions upload`, version `b4700ebb-…`) was never promoted to 100% traffic.

That stayed true until **#402** (`bd3ea40`) merged. Workers Build `83c54401-61b2-4070-ab5a-38982e3d6eb8` ran the same `npx wrangler deploy` command, injected the postinstall guard, reached `Building list of assets`, and deployed version `7a7d1ec0-95fe-42b5-8ad4-81f4beb5b4da`. Production `GET /api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` then returns **200** `application/javascript` (Express + jsDelivr `x-jsd-version: 6.31.0`), not `worker_api_failure` JSON.

## Other wrangler abort after a successful upload

PR preview build `69ef1bcb-decb-4b0d-9678-9344872f6c8c` (#402 branch `cursor/fix-main-wrangler-deploy-f255`) **did** upload version `28346896-021c-4567-be4a-8e17d9684b40`, then wrangler treated a later call as fatal:

```
GET /accounts/.../workers/subdomain -> 503 Service Unavailable
upstream connect error or disconnect/reset before headers
```

Workers Builds still marks the build failed. The version exists as a preview only.

## Repo guard

`pnpm install` copies `scripts/cloudflare/wrangler-deployments-guard.cjs` next to wrangler's bin and injects `node --require`. On GET `/deployments` or GET `/workers/subdomain` (and the script `/subdomain` settings GET):

1. Retry with `JSON.parse` (recovers valid JSON that jsonc-parser rejected).
2. On still-unparseable **200** or **5xx**, continue with a dummy payload (empty deployments list, or `subdomain: anima-protocol`). Those GETs are not the upload.

Optional dashboard replacement (same repo, not required if the guard holds):

```
node scripts/cloudflare/workers-builds-deploy.mjs deploy --assets=./dist --compatibility-date=2026-08-14 --name anima-protocol
```

That wrapper exits 0 if wrangler printed `Worker Version ID:` then died on those informational GETs.

Do not remove `api/index.mjs`. Do not put secret values in this file or `wrangler.jsonc`.
