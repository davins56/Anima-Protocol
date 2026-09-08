import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { injectRequireIntoWranglerBin } from "../../../scripts/cloudflare/install-wrangler-deploy-guard.mjs";
import { wranglerSucceededDespiteInformationalGet } from "../../../scripts/cloudflare/workers-builds-deploy.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const require = createRequire(import.meta.url);
const guard = require(path.join(
  repoRoot,
  "scripts/cloudflare/wrangler-deployments-guard.cjs",
));

const SPAWN_SNIPPET = `	return spawn(
		process.execPath,
		[
			"--no-warnings",
			...process.execArgv,
			path.join(__dirname, "../wrangler-dist/cli.js"),
			...process.argv.slice(2),
		],
		{
			stdio: ["inherit", "inherit", "inherit", "ipc"],
		}
	)`;

describe("wrangler GET /deployments guard", () => {
  it("identifies the production deployments list endpoint", () => {
    expect(
      guard.isDeploymentsListResource(
        "GET",
        "/accounts/abc/workers/scripts/anima-protocol/deployments",
      ),
    ).toBe(true);
    expect(
      guard.isDeploymentsListResource(
        "POST",
        "/accounts/abc/workers/scripts/anima-protocol/deployments",
      ),
    ).toBe(false);
    expect(
      guard.isDeploymentsListResource(
        "GET",
        "/accounts/abc/workers/scripts/anima-protocol/versions",
      ),
    ).toBe(false);
  });

  it("identifies post-upload workers.dev subdomain GETs as informational", () => {
    expect(
      guard.isInformationalGet(
        "GET",
        "/accounts/abc/workers/subdomain",
      ),
    ).toBe(true);
    expect(
      guard.isInformationalGet(
        "GET",
        "/accounts/abc/workers/scripts/anima-protocol/subdomain",
      ),
    ).toBe(true);
    expect(
      guard.isInformationalGet(
        "GET",
        "/accounts/abc/workers/subdomain/edge-preview",
      ),
    ).toBe(false);
    expect(
      guard.isInformationalGet(
        "POST",
        "/accounts/abc/workers/subdomain",
      ),
    ).toBe(false);
  });

  it("recovers valid JSON that jsonc-parser might still reject at wrap time", () => {
    const body = JSON.stringify({
      success: true,
      result: {
        deployments: [{ id: "b031e405-3c70-4312-819c-c08281ef93e9" }],
      },
    });
    expect(guard.recoverDeploymentsListJson(body)).toEqual(JSON.parse(body));
  });

  it("returns an empty deployments list when the 200 body is not JSON", () => {
    const recovered = guard.recoverDeploymentsListJson(
      '{ "result": { "deployments": [ { "id": "b031e405-3c70-4312-819c-c08281ef93e9",',
    );
    expect(recovered.success).toBe(true);
    expect(recovered.result.deployments).toEqual([]);
  });

  it("returns a dummy workers.dev subdomain when GET /subdomain is envoy 503 text", () => {
    const recovered = guard.recoverInformationalGetJson(
      "/accounts/abc/workers/subdomain",
      "upstream connect error or disconnect/reset before headers. reset reason: connection termination",
    );
    expect(recovered.success).toBe(true);
    expect(recovered.result.subdomain).toBe("anima-protocol");
  });

  it("patches wrangler fetchInternalBase so GET /deployments cannot abort deploy", () => {
    const cli = `'use strict';
async function fetchInternalBase(complianceConfig, resource, init4 = {}, userAgent, logger6, queryParams, abortSignal, credentials) {
  const method = init4.method ?? "GET";
  const jsonText = "{}";
${guard.PARSE_TRY}
    throw new APIError({ text: "Received a malformed response from the API" });
  }
}`;
    const patched = guard.patchWranglerCliSource(cli);
    expect(patched).toContain(guard.MARKER);
    expect(patched).toContain("isAnimaInformationalGet(method, resource)");
    expect(patched).toContain("recoverAnimaInformationalGetJson(resource, jsonText)");
    expect(guard.patchWranglerCliSource(patched)).toBe(patched);
  });

  it("treats wrangler exit 1 after Worker Version ID + subdomain 503 as success", () => {
    const log = [
      "Uploaded anima-protocol (4.27 sec)",
      "Worker Version ID: 28346896-021c-4567-be4a-8e17d9684b40",
      "Received a malformed response from the API",
      "GET /accounts/347aa4800fdcf7570476a4c47f4bf9a5/workers/subdomain -> 503 Service Unavailable",
      "upstream connect error or disconnect/reset before headers",
    ].join("\n");
    expect(wranglerSucceededDespiteInformationalGet(log, 1)).toBe(true);
    expect(
      wranglerSucceededDespiteInformationalGet(
        "Received a malformed response from the API\nGET /accounts/x/workers/scripts/anima-protocol/deployments -> 200 OK",
        1,
      ),
    ).toBe(false);
  });

  it("injects --require into wrangler/bin/wrangler.js spawn args", () => {
    const patched = injectRequireIntoWranglerBin(
      SPAWN_SNIPPET,
      'path.join(__dirname, "./anima-deployments-guard.cjs")',
    );
    expect(patched).toContain("--require");
    expect(patched).toContain("anima-deployments-guard.cjs");
    expect(injectRequireIntoWranglerBin(patched, "x")).toBe(patched);
  });

  it("writes the guard next to a fake wrangler bin", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anima-wrangler-guard-"));
    try {
      const bin = path.join(dir, "wrangler.js");
      writeFileSync(bin, `#!/usr/bin/env node\n${SPAWN_SNIPPET}\n`);
      const dest = path.join(dir, "anima-deployments-guard.cjs");
      writeFileSync(
        dest,
        readFileSync(
          path.join(repoRoot, "scripts/cloudflare/wrangler-deployments-guard.cjs"),
        ),
      );
      const after = injectRequireIntoWranglerBin(
        readFileSync(bin, "utf8"),
        'path.join(__dirname, "./anima-deployments-guard.cjs")',
      );
      writeFileSync(bin, after);
      expect(readFileSync(bin, "utf8")).toContain("--require");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
