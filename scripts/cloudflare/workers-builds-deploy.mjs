#!/usr/bin/env node
/**
 * Optional Workers Builds deploy wrapper (git cannot edit the dashboard
 * command). After `pnpm build`:
 *
 *   node scripts/cloudflare/workers-builds-deploy.mjs deploy --assets=./dist --compatibility-date=2026-08-14 --name anima-protocol
 *   node scripts/cloudflare/workers-builds-deploy.mjs versions upload --assets=./dist --compatibility-date=2026-08-14 --name anima-protocol
 *
 * If wrangler prints a Worker Version ID then dies on GET /deployments or
 * GET /workers/subdomain (malformed 200 / 503), exit 0 — the version
 * already uploaded. The postinstall `--require` guard is what keeps the
 * existing dashboard `npx wrangler …` commands from aborting *before*
 * upload; this script is belt-and-suspenders for post-upload flakes.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export function wranglerSucceededDespiteInformationalGet(output, exitCode) {
  const text = String(output ?? "");
  const uploaded = /Worker Version ID:/i.test(text) || /Current Version ID:/i.test(text);
  if (Number(exitCode) === 0) return true;
  if (!uploaded) return false;
  const informational = /\/workers\/scripts\/[^/\s]+\/deployments/i.test(text) ||
    /\/workers\/subdomain/i.test(text);
  const flake = /malformed response from the API/i.test(text) ||
    /503 Service Unavailable/i.test(text) ||
    /upstream connect error/i.test(text);
  return informational && flake;
}

function wranglerBin() {
  const pkg = path.dirname(require.resolve("wrangler/package.json"));
  return path.join(pkg, "bin", "wrangler.js");
}

function main() {
  const args = process.argv.slice(2);
  const bin = wranglerBin();
  const child = spawn(process.execPath, [bin, ...args], {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
  let combined = "";
  const attach = (stream, dest) => {
    stream.on("data", (chunk) => {
      combined += chunk.toString("utf8");
      dest.write(chunk);
    });
  };
  attach(child.stdout, process.stdout);
  attach(child.stderr, process.stderr);
  child.on("error", (err) => {
    console.error(err);
    process.exit(1);
  });
  child.on("close", (code) => {
    if (wranglerSucceededDespiteInformationalGet(combined, code)) {
      console.warn(
        "[anima-wrangler-guard] wrangler exited after a successful upload on an informational GET; treating as success.",
      );
      process.exit(0);
    }
    process.exit(code ?? 1);
  });
}

const invoked =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main();
}
