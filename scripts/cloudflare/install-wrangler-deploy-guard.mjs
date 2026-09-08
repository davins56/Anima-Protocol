#!/usr/bin/env node
/**
 * Copy the informational-GET parse guard next to wrangler's bin and inject
 * `node --require` so `npx wrangler deploy` / `versions upload` (Workers
 * Builds) load it. Covers GET /deployments (before production upload) and
 * GET /workers/subdomain (after upload). Idempotent. Skips when wrangler
 * is not installed.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const guardSrc = path.join(here, "wrangler-deployments-guard.cjs");

const REQUIRE_NEEDLE = "anima-deployments-guard.cjs";

function wranglerBinPath() {
  try {
    const pkg = path.dirname(require.resolve("wrangler/package.json"));
    return path.join(pkg, "bin", "wrangler.js");
  } catch {
    return null;
  }
}

export function injectRequireIntoWranglerBin(source, requireExpr) {
  const text = String(source ?? "");
  if (text.includes(REQUIRE_NEEDLE)) return text;
  const original = `			"--no-warnings",
			...process.execArgv,
			path.join(__dirname, "../wrangler-dist/cli.js"),`;
  const patched = `			"--no-warnings",
			"--require",
			${requireExpr},
			...process.execArgv,
			path.join(__dirname, "../wrangler-dist/cli.js"),`;
  if (!text.includes(original)) {
    throw new Error(
      "wrangler/bin/wrangler.js spawn args changed; cannot inject deployments guard",
    );
  }
  return text.replace(original, patched);
}

function main() {
  const bin = wranglerBinPath();
  if (!bin) {
    console.warn(
      "[anima-wrangler-guard] wrangler is not installed; skip deploy guard",
    );
    return;
  }
  const destGuard = path.join(path.dirname(bin), REQUIRE_NEEDLE);
  copyFileSync(guardSrc, destGuard);
  const before = readFileSync(bin, "utf8");
  const after = injectRequireIntoWranglerBin(
    before,
    'path.join(__dirname, "./anima-deployments-guard.cjs")',
  );
  if (after !== before) {
    writeFileSync(bin, after);
    console.log("[anima-wrangler-guard] injected --require into wrangler/bin/wrangler.js");
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main();
}
