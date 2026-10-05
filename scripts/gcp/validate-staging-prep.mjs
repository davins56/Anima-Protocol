#!/usr/bin/env node
/**
 * Secret-free checks for the Cloud Run staging prep. Safe to run in CI.
 * Does not call gcloud or deploy.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function fail(message) {
  console.error(`gcp-staging-prep: ${message}`);
  process.exitCode = 1;
}

const SECRET_VALUE = /sk_live_[A-Za-z0-9]{8,}|sk_test_[A-Za-z0-9]{8,}|postgres(?:ql)?:\/\/[^\s"'`]+|-----BEGIN |AIza[0-9A-Za-z_-]{20,}|"private_key":/i;

const files = [
  "deploy/gcp/Dockerfile",
  "deploy/gcp/cloudrun.service.yaml",
  "deploy/gcp/cloudbuild.yaml",
  "deploy/gcp/env.example",
  "deploy/gcp/secret-names.txt",
  "deploy/gcp/README.md",
  "deploy/gcp/gcloud-deploy.sh",
  ".github/workflows/gcp-cloudrun-staging.yml",
];

for (const rel of files) {
  const source = read(rel);
  if (SECRET_VALUE.test(source)) {
    fail(`${rel} looks like it contains a secret value`);
  }
}

const workflow = read(".github/workflows/gcp-cloudrun-staging.yml");
if (!/^on:\s*\n\s*workflow_dispatch:/m.test(workflow)) {
  fail("GCP workflow must be workflow_dispatch-only");
}
if (/^on:[\s\S]*?(push:|pull_request:)/m.test(workflow.split("jobs:")[0] ?? "")) {
  fail("GCP workflow must not run on push or pull_request");
}
if (!workflow.includes("google-github-actions/auth@v2")) {
  fail("GCP workflow must use Workload Identity Federation (google-github-actions/auth)");
}
if (/credentials_json|GCP_SA_KEY|service_account_key/i.test(workflow)) {
  fail("GCP workflow must not use a long-lived service account JSON key");
}
if (!workflow.includes("deploy-staging")) {
  fail("GCP workflow must require an explicit deploy-staging confirmation");
}
if (!workflow.includes("--min-instances 0") || !workflow.includes("--max-instances 2")) {
  fail("GCP workflow must keep scale-to-zero and max-instances=2");
}

const dockerfile = read("deploy/gcp/Dockerfile");
if (!dockerfile.includes("FROM node:24-bookworm-slim")) {
  fail("Dockerfile must use Node 24");
}
if (!dockerfile.includes("dist/cloudrun.mjs")) {
  fail("Dockerfile must run the Cloud Run bundle");
}
if (!dockerfile.includes("ANIMA_RUNTIME=cloudrun")) {
  fail("Dockerfile must pin ANIMA_RUNTIME=cloudrun");
}
if (!dockerfile.includes("ANIMA_LLM_PROVIDER=custom")) {
  fail("Dockerfile must pin ANIMA_LLM_PROVIDER=custom (fail-closed chat)");
}
if (/OPENROUTER_API_KEY=|ANTHROPIC_API_KEY=|MINIMAX_API_KEY=/.test(dockerfile)) {
  fail("Dockerfile must not bake third-party chat keys");
}

const service = read("deploy/gcp/cloudrun.service.yaml");
if (!service.includes('autoscaling.knative.dev/minScale: "0"')) {
  fail("Cloud Run spec must scale to zero");
}
if (!service.includes('autoscaling.knative.dev/maxScale: "2"')) {
  fail("Cloud Run spec must cap maxScale at 2");
}
if (!service.includes("path: /api/healthz")) {
  fail("Cloud Run spec must probe /api/healthz");
}

const pkg = JSON.parse(read("package.json"));
if (!String(pkg.scripts?.["deploy:cloudflare"] ?? "").includes("workers-builds-deploy.mjs")) {
  fail("Must not change package.json deploy:cloudflare");
}

const wrangler = read("wrangler.jsonc");
if (!wrangler.includes('"main": "artifacts/api-server/src/worker.ts"')) {
  fail("wrangler.jsonc main entry must stay worker.ts");
}
if (!wrangler.includes('"name": "anima-protocol"')) {
  fail("wrangler.jsonc Worker name must stay anima-protocol");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("gcp-staging-prep: ok");
