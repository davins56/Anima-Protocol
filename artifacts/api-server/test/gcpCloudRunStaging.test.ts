import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  getLlmRoutingStatus,
  getProviderChain,
} from "../src/lib/llmFailover";
import {
  attachNodeSpaFallback,
  shouldAttachNodeSpa,
  tryServeNodeSpa,
} from "../src/lib/nodeSpa";
import {
  isCloudRunRuntime,
  isLoopbackUnreachableRuntime,
  localLlmBaseUrl,
  resetLlmClientsForTests,
} from "../src/lib/openaiClient";
import { resetAiBindingForTests } from "../src/lib/aiBinding";
import { HASHED_ASSET_CACHE_CONTROL } from "../src/lib/spaAssetFallback";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readRepo(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("GCP Cloud Run staging prep", () => {
  it("validate-staging-prep.mjs passes and stays secret-free", () => {
    const output = execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts/gcp/validate-staging-prep.mjs")],
      { encoding: "utf8" },
    );
    expect(output).toMatch(/gcp-staging-prep: ok/);
  });

  it("keeps the GCP GitHub workflow manual-only with Workload Identity", () => {
    const workflow = readRepo(".github/workflows/gcp-cloudrun-staging.yml");
    const header = workflow.split("jobs:")[0] ?? "";
    expect(header).toMatch(/workflow_dispatch:/);
    expect(header).not.toMatch(/^\s+push:/m);
    expect(header).not.toMatch(/^\s+pull_request:/m);
    expect(workflow).toContain("google-github-actions/auth@v2");
    expect(workflow).toContain("workload_identity_provider");
    expect(workflow).not.toMatch(/credentials_json|GCP_SA_KEY/);
    expect(workflow).toContain("deploy-staging");
    expect(workflow).toContain("--min-instances 0");
    expect(workflow).toContain("--max-instances 2");
    expect(workflow).toContain("/api/healthz");
    expect(workflow).not.toMatch(/sk_live_|sk_test_[A-Za-z0-9]{8,}/);
  });

  it("does not alter Cloudflare production deploy wiring", () => {
    const pkg = JSON.parse(readRepo("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["deploy:cloudflare"]).toContain(
      "workers-builds-deploy.mjs",
    );
    expect(pkg.scripts?.["deploy:cloudflare"]).toContain(
      "--name anima-protocol",
    );
    expect(pkg.scripts?.["gcp:validate"]).toBe(
      "node scripts/gcp/validate-staging-prep.mjs",
    );
    const wrangler = readRepo("wrangler.jsonc");
    expect(wrangler).toContain('"main": "artifacts/api-server/src/worker.ts"');
    expect(wrangler).toContain('"name": "anima-protocol"');
    expect(wrangler).toContain('"binding": "AI"');
    expect(wrangler).toContain("deepseek-gateway");
    expect(wrangler).toContain('"binding": "HYPERDRIVE"');
    expect(readRepo("artifacts/api-server/src/worker.ts")).not.toMatch(
      /nodeSpa|ANIMA_STATIC_DIR/,
    );
    expect(readRepo("artifacts/api-server/src/vercel.ts")).not.toMatch(
      /nodeSpa|ANIMA_STATIC_DIR/,
    );
    expect(readRepo("artifacts/api-server/src/index.ts")).toContain(
      "tryServeNodeSpa",
    );
    expect(readRepo("artifacts/api-server/src/index.ts")).toContain(
      "http.createServer",
    );
    expect(readRepo("artifacts/api-server/build.mjs")).toContain("cloudrun.mjs");
  });

  it("pins fail-closed chat and health probes on the Cloud Run image", () => {
    const docker = readRepo("deploy/gcp/Dockerfile");
    expect(docker).toMatch(/FROM node:24-bookworm-slim/);
    expect(docker).toContain("ANIMA_RUNTIME=cloudrun");
    expect(docker).toContain("ANIMA_LLM_PROVIDER=custom");
    expect(docker).toContain("ANIMA_STATIC_DIR=/app/public");
    expect(docker).toContain("dist/cloudrun.mjs");
    expect(docker).toContain("/api/healthz");
    expect(docker).not.toMatch(/OPENROUTER_API_KEY=|ANTHROPIC_API_KEY=/);
    const yaml = readRepo("deploy/gcp/cloudrun.service.yaml");
    expect(yaml).toContain('autoscaling.knative.dev/minScale: "0"');
    expect(yaml).toContain('autoscaling.knative.dev/maxScale: "2"');
    expect(yaml).toContain("path: /api/healthz");
    expect(yaml).toContain("PLACEHOLDER_PROJECT_ID");
    expect(yaml).not.toMatch(/postgres(?:ql)?:\/\//i);
    const runbook = readRepo("deploy/gcp/README.md");
    expect(runbook).toMatch(/Fail-closed/);
    expect(runbook).toMatch(/No Hyperdrive/);
    expect(runbook).toMatch(/Workload Identity/);
    expect(runbook).toMatch(/GCP project ID/);
    expect(runbook).not.toMatch(/sk_live_|sk_test_[A-Za-z0-9]{8,}/);
  });
});

describe("Cloud Run chat stays fail-closed", () => {
  const SAVED = { ...process.env };

  afterEach(() => {
    process.env = { ...SAVED };
    resetAiBindingForTests();
    resetLlmClientsForTests();
  });

  it("treats ANIMA_RUNTIME=cloudrun and K_SERVICE as no-loopback Cloud Run", () => {
    delete process.env.ANIMA_RUNTIME;
    delete process.env.K_SERVICE;
    delete process.env.VERCEL;
    expect(isCloudRunRuntime({ ANIMA_RUNTIME: "cloudrun" })).toBe(true);
    expect(isCloudRunRuntime({ K_SERVICE: "anima-protocol-staging" })).toBe(
      true,
    );
    expect(isCloudRunRuntime({ ANIMA_RUNTIME: "node", K_SERVICE: "x" })).toBe(
      false,
    );
    expect(
      isLoopbackUnreachableRuntime({ ANIMA_RUNTIME: "cloudrun" }),
    ).toBe(true);
    expect(
      isLoopbackUnreachableRuntime({ K_SERVICE: "anima-protocol-staging" }),
    ).toBe(true);
    expect(
      localLlmBaseUrl({ ANIMA_RUNTIME: "cloudrun" } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("does not use OpenRouter or MiniMax when Cloud Run has no Workers AI binding", () => {
    process.env.ANIMA_RUNTIME = "cloudrun";
    process.env.ANIMA_LLM_PROVIDER = "custom";
    process.env.K_SERVICE = "anima-protocol-staging";
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.MINIMAX_API_KEY = "minimax-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    resetAiBindingForTests();
    expect(getProviderChain()).toEqual([]);
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.chain).toEqual([]);
    expect(status.workersai.configured).toBe(false);
    expect(status.note).toMatch(/Cloud Run staging has no Workers AI binding/i);
    expect(status.note).toMatch(/OpenRouter, Claude, or MiniMax/i);
    expect(status.note).not.toMatch(/primary cloud provider/i);
  });
});

describe("Node SPA fallback (Cloud Run only)", () => {
  it("does not attach on Worker/Vercel runtimes even when a directory is set", () => {
    expect(
      shouldAttachNodeSpa({
        ANIMA_RUNTIME: "worker",
        ANIMA_STATIC_DIR: "/tmp",
      }),
    ).toBe(false);
    expect(
      shouldAttachNodeSpa({
        ANIMA_RUNTIME: "vercel",
        ANIMA_STATIC_DIR: "/tmp",
      }),
    ).toBe(false);
  });

  it("serves index.html for client routes and 404s missing hashed assets", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anima-spa-"));
    writeFileSync(path.join(dir, "index.html"), "<html>spa</html>\n");
    writeFileSync(path.join(dir, "ok.txt"), "static-ok\n");
    const app = express();
    app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
    expect(
      attachNodeSpaFallback(app, {
        ANIMA_RUNTIME: "cloudrun",
        ANIMA_STATIC_DIR: dir,
      }),
    ).toBe(true);

    const server: Server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server did not bind");
      }
      const base = `http://127.0.0.1:${address.port}`;

      const health = await fetch(`${base}/api/healthz`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ status: "ok" });

      const spa = await fetch(`${base}/characters`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("spa");

      const asset = await fetch(`${base}/ok.txt`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toBe("static-ok\n");

      const missing = await fetch(`${base}/assets/stale-AbCdEf.js`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-type")).toMatch(/text\/plain/);
      expect(await missing.text()).toMatch(/Not Found/);
      expect(HASHED_ASSET_CACHE_CONTROL).toMatch(/max-age=31536000/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves SPA before Express so Clerk-like middleware cannot 503 client routes", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anima-spa-http-"));
    writeFileSync(path.join(dir, "index.html"), "<html>spa-first</html>\n");
    const app = express();
    app.use((_req, res) => {
      res.status(503).json({ error: "clerk" });
    });
    const env = {
      ANIMA_RUNTIME: "cloudrun",
      ANIMA_STATIC_DIR: dir,
    } as NodeJS.ProcessEnv;

    const server: Server = await new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        if (tryServeNodeSpa(req, res, env)) return;
        app(req, res);
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("test server did not bind");
      }
      const base = `http://127.0.0.1:${address.port}`;
      const spa = await fetch(`${base}/characters`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("spa-first");
      const missing = await fetch(`${base}/assets/stale-AbCdEf.js`);
      expect(missing.status).toBe(404);
      const api = await fetch(`${base}/api/healthz`);
      expect(api.status).toBe(503);
      await expect(api.json()).resolves.toEqual({ error: "clerk" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
