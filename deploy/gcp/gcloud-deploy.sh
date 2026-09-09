#!/usr/bin/env bash
# Manual Cloud Run staging deploy. Never called from Cloudflare Workers Builds.
# Does not change DNS. Refuses to run unless CONFIRM=deploy-staging.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CONFIRM="${CONFIRM:-}"
if [[ "$CONFIRM" != "deploy-staging" ]]; then
  echo "Refusing to deploy. Set CONFIRM=deploy-staging (staging/backup only)." >&2
  echo "This script never updates anima-protocol.com DNS or the production Worker." >&2
  exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
AR_REPO="${GCP_AR_REPOSITORY:-anima-protocol}"
SERVICE="${CLOUD_RUN_SERVICE:-anima-protocol-staging}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/anima-protocol-staging:${IMAGE_TAG}"
VITE_KEY="${VITE_CLERK_PUBLISHABLE_KEY:?Set VITE_CLERK_PUBLISHABLE_KEY (public pk_ test/live)}"

if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  echo "GOOGLE_APPLICATION_CREDENTIALS is set. Prefer Workload Identity Federation; do not commit JSON keys." >&2
fi

echo "Project:  ${PROJECT_ID}"
echo "Region:   ${REGION}"
echo "Service:  ${SERVICE}"
echo "Image:    ${IMAGE}"
echo "DNS:      unchanged (Cloudflare production stays on anima-protocol.com)"

gcloud config set project "${PROJECT_ID}"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  cloudbuild.googleapis.com \
  --project "${PROJECT_ID}"

if ! gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${AR_REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Anima Protocol Cloud Run staging images" \
    --project="${PROJECT_ID}"
fi

gcloud builds submit \
  --config deploy/gcp/cloudbuild.yaml \
  --project "${PROJECT_ID}" \
  --substitutions="_REGION=${REGION},_AR_REPO=${AR_REPO},_IMAGE_TAG=${IMAGE_TAG},_VITE_CLERK_PUBLISHABLE_KEY=${VITE_KEY},_VITE_CLERK_PROXY_URL=${VITE_CLERK_PROXY_URL:-},_VITE_API_ORIGIN=${VITE_API_ORIGIN:-}"

gcloud run deploy "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --platform managed \
  --port 8080 \
  --cpu 1 \
  --memory 1Gi \
  --min-instances 0 \
  --max-instances 2 \
  --concurrency 80 \
  --timeout 60 \
  --cpu-boost \
  --execution-environment gen2 \
  --set-env-vars "NODE_ENV=production,ANIMA_RUNTIME=cloudrun,ANIMA_LLM_PROVIDER=custom,ANIMA_STATIC_DIR=/app/public" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,CLERK_SECRET_KEY=CLERK_SECRET_KEY:latest,CLERK_PUBLISHABLE_KEY=CLERK_PUBLISHABLE_KEY:latest" \
  --allow-unauthenticated

echo
echo "Deployed ${SERVICE}. Health:"
echo "  curl -fsS \"\$(gcloud run services describe ${SERVICE} --region ${REGION} --format='value(status.url)')/api/healthz\""
echo "  curl -fsS \".../api/healthz/llm\"   # expect chain=[] and Cloud Run fail-closed note"
echo "Rollback: gcloud run services update-traffic ${SERVICE} --region ${REGION} --to-revisions REVISION=100"
echo "Teardown: gcloud run services delete ${SERVICE} --region ${REGION}"
