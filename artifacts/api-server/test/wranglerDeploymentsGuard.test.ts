import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { injectRequireIntoWranglerBin } from "../../../scripts/cloudflare/install-wrangler-deploy-guard.mjs";

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
    expect(patched).toContain("isAnimaDeploymentsListGet(method, resource)");
    expect(patched).toContain("recoverAnimaDeploymentsListJson(jsonText)");
    expect(guard.patchWranglerCliSource(patched)).toBe(patched);
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
  });
});
