/**
 * Guard the Cloudflare asset upload against a partial / mismatched SPA build.
 *
 * Vite lazy-route chunks (EchoKeys, UserProfile, …) are not listed in
 * index.html — only the entry + modulepreloads are. If a deploy copies a
 * stale index that references old hashes, or drops a lazy chunk, Workers
 * `not_found_handling: single-page-application` used to serve homepage HTML
 * for `/assets/*.js` and the browser threw a MIME error.
 *
 * Usage: node scripts/assertSpaAssets.js [distDir]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_CHUNK_PREFIXES = ["EchoKeys-", "UserProfile-"];

export function listHashedJs(assetDir) {
  if (!existsSync(assetDir)) return [];
  return readdirSync(assetDir).filter((name) => /^[\w.-]+\.js$/.test(name));
}

export function findRequiredChunks(jsFiles, prefixes = REQUIRED_CHUNK_PREFIXES) {
  const missing = [];
  const found = {};
  for (const prefix of prefixes) {
    const match = jsFiles.find((name) => name.startsWith(prefix));
    if (match) found[prefix] = match;
    else missing.push(prefix);
  }
  return { found, missing };
}

export function isJavaScriptBytes(buf) {
  const head = buf.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return false;
  return true;
}

export function collectIndexJsRefs(html) {
  const refs = new Set();
  const re = /\/assets\/([A-Za-z0-9_.-]+\.js)/g;
  let m;
  while ((m = re.exec(html))) refs.add(m[1]);
  return [...refs];
}

export function assertSpaAssets(distDir) {
  const indexPath = join(distDir, "index.html");
  const assetDir = join(distDir, "assets");
  if (!existsSync(indexPath)) {
    throw new Error(`SPA assert: missing ${indexPath}`);
  }
  if (!existsSync(assetDir)) {
    throw new Error(`SPA assert: missing ${assetDir}`);
  }

  const jsFiles = listHashedJs(assetDir);
  const { found, missing } = findRequiredChunks(jsFiles);
  if (missing.length) {
    throw new Error(
      `SPA assert: Vite did not emit required lazy chunks: ${missing.join(", ")}. ` +
        `assets/ has ${jsFiles.length} .js files.`,
    );
  }

  for (const file of Object.values(found)) {
    const buf = readFileSync(join(assetDir, file));
    if (!isJavaScriptBytes(buf)) {
      throw new Error(
        `SPA assert: ${file} looks like HTML, not JavaScript. ` +
          `Refusing to deploy a homepage fallback as a module chunk.`,
      );
    }
  }

  const html = readFileSync(indexPath, "utf8");
  const refs = collectIndexJsRefs(html);
  const absent = refs.filter((name) => !jsFiles.includes(name));
  if (absent.length) {
    throw new Error(
      `SPA assert: index.html references JS that is not in assets/: ${absent.join(", ")}`,
    );
  }

  return { found, refs: refs.length, jsFiles: jsFiles.length };
}

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const here = dirname(fileURLToPath(import.meta.url));
  const distDir = resolve(process.argv[2] || join(here, "..", "dist", "public"));
  const result = assertSpaAssets(distDir);
  console.log(
    `[assert-spa-assets] ok — EchoKeys=${result.found["EchoKeys-"]} ` +
      `UserProfile=${result.found["UserProfile-"]} ` +
      `indexRefs=${result.refs} jsFiles=${result.jsFiles}`,
  );
}
