# Anima Protocol — Google Cloud staging / backup

Staging and disaster-recovery **prep only**. Production stays on **Cloudflare Workers** (`anima-protocol.com`). This tree does not cut over DNS, does not change `wrangler.jsonc`, and does not deploy anything until you provide a billing-enabled GCP project.

Do **not** run these commands against production DNS or the `anima-protocol` Worker.

## What Cloud Run can and cannot run

| Surface | Cloudflare Worker (production) | Cloud Run (this staging image) |
|---|---|---|
| Vite SPA + Express `/api/*` | Yes (Assets + `worker.ts`) | Yes (Node `cloudrun.mjs` + `ANIMA_STATIC_DIR`) |
| Clerk `/api/__clerk` proxy | Yes | Yes on the `*.run.app` host |
| `clerk.anima-protocol.com` CNAME gateway (`/v1/*`) | Yes (Worker custom domain) | **No** — Worker-only. Do not move this hostname. |
| Postgres | Hyperdrive + Secrets Store `DATABASE_URL` | Direct `DATABASE_URL` (Supabase pooler or Cloud SQL). **No Hyperdrive.** |
| Chat | Workers AI DeepSeek `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` via AI Gateway `deepseek-gateway` | **Fail-closed.** There is no `env.AI` binding. OpenRouter / Claude / MiniMax are **not** used. |
| Secrets Store / `wrangler secret` | Yes | Secret Manager (names in `secret-names.txt`) |
| `/api/healthz` | Yes | Yes (Cloud Run startup + liveness probe) |

Chat on GCP is **not** equivalent to production. `/api/healthz/llm` must report `chain: []` and `workersai.configured: false` unless you later design an explicit Workers AI REST path (not included here).

## Values you must provide (one-time)

No project or billing account is in this repo. Fill these before the first deploy:

| Input | Example / notes |
|---|---|
| GCP project ID | Billing enabled. `gcloud projects describe PROJECT_ID` |
| GCP region | Default in files: `us-central1` |
| Artifact Registry repo name | Default: `anima-protocol` |
| Cloud Run service name | Default: `anima-protocol-staging` |
| Workload Identity Federation | Pool + provider + GitHub service account email. **Do not** mint a long-lived JSON key if WIF is available. |
| Cloud Run runtime SA | Needs `roles/secretmanager.secretAccessor` |
| Clerk keys | Prefer **Development** `pk_test_` / `sk_test_` for staging. Add the Cloud Run URL to Clerk allowed origins and redirect URLs. |
| `DATABASE_URL` | Staging Postgres preferred. Direct TCP — not Hyperdrive. |
| Vite `VITE_CLERK_PUBLISHABLE_KEY` | Build-arg (public). Must match the runtime `CLERK_PUBLISHABLE_KEY` instance. |

Optional later: a **separate** staging Clerk instance and a **separate** Supabase/Postgres database so a backup never writes production user entities.

## Cost guardrails (already in the service spec)

- `minScale` / `--min-instances=0` (scale to zero)
- `maxScale` / `--max-instances=2`
- 1 vCPU / 1 GiB, 60s request timeout, concurrency 80
- CPU throttling on, startup CPU boost on (cold start only)

Idle cost is near zero besides Artifact Registry storage and Secret Manager.

## Manual deploy (gcloud)

```bash
# 1. Create secrets (values stay in the dashboard / your shell — not git)
gcloud secrets create DATABASE_URL --data-file=-   # paste, newline, Ctrl-D
gcloud secrets create CLERK_SECRET_KEY --data-file=-
gcloud secrets create CLERK_PUBLISHABLE_KEY --data-file=-

# 2. Build + deploy (refuses unless CONFIRM matches)
export GCP_PROJECT_ID=... GCP_REGION=us-central1
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CONFIRM=deploy-staging bash deploy/gcp/gcloud-deploy.sh
```

Equivalent image-only build:

```bash
gcloud builds submit --config deploy/gcp/cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_AR_REPO=anima-protocol,_IMAGE_TAG=manual,_VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

## Manual GitHub Actions

`.github/workflows/gcp-cloudrun-staging.yml` is **`workflow_dispatch` only**. It does not run on `push` or `pull_request`. Type `deploy-staging` in the confirm input.

GitHub secrets / variables to add when you are ready (names only):

- `GCP_PROJECT_ID`
- `GCP_WIF_PROVIDER` — `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`
- `GCP_WIF_SERVICE_ACCOUNT` — `github-deploy@PROJECT_ID.iam.gserviceaccount.com`
- `VITE_CLERK_PUBLISHABLE_KEY`

WIF setup (once per project): [Google GitHub Actions auth](https://github.com/google-github-actions/auth). Do not upload `*-sa.json` keys.

## Health checks

| Probe | Path | Expect |
|---|---|---|
| Liveness / startup | `GET /api/healthz` | `{"status":"ok"}` |
| Clerk keys present | `GET /api/healthz/env` | booleans only, no secret values |
| Postgres | `GET /api/healthz/db` | 200 if schema exists; 503 + `target` if not |
| Chat routing | `GET /api/healthz/llm` | `status: "error"`, `chain: []`, Cloud Run fail-closed note |

## Rollback / teardown

```bash
# Roll traffic back to a previous Cloud Run revision
gcloud run services update-traffic anima-protocol-staging \
  --region us-central1 --to-revisions REVISION_NAME=100

# Delete the staging service (production Worker is untouched)
gcloud run services delete anima-protocol-staging --region us-central1

# Optional: delete the image repo after the service is gone
gcloud artifacts repositories delete anima-protocol --location us-central1
```

Cloudflare production rollback remains `npx wrangler rollback` / Workers versions — see `scripts/cloudflare/workers-builds-deploy.md`. This GCP path cannot roll back the Worker.

## Clerk on `*.run.app`

1. Register `https://SERVICE-xxxxx.run.app/sign-in/sso-callback` (and sign-up) in Clerk → Paths.
2. Leave `VITE_CLERK_PROXY_URL` empty so the SPA uses same-origin `/api/__clerk/` when the publishable key is `pk_live_`. Development `pk_test_` keys talk to Clerk directly.
3. Do **not** point `clerk.anima-protocol.com` at Cloud Run.

## Explicit non-goals

- No DNS cutover (`anima-protocol.com`, `www`, `clerk.` stay on Cloudflare).
- No change to `deploy:cloudflare` or Workers Builds.
- No OpenRouter/Claude/MiniMax chat fallback on this image.
- No Hyperdrive or Workers AI binding on Cloud Run.
- No deploy in this PR — there is no GCP project in repo secrets.
