#!/usr/bin/env node
// Fails CI when a tracked file contains something that looks like a real
// credential. Placeholders (sk_test_abc…, "sk_live_…" in prose) stay allowed:
// each pattern requires a long, key-shaped body.
//
// Run: node scripts/ci/check-no-secrets.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  { name: "Clerk/Stripe live secret key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}/ },
  { name: "OpenAI key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{20,}/ },
  {
    name: "Private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*\n[A-Za-z0-9+/=]{40,}/,
  },
];

// Test fixtures use obviously fake bodies; a real key never contains a run
// of sequential digits or the alphabet.
const FAKE_BODY = /0123456789|abcdefghij|xxxxxxxxxx|your[_-]?key|placeholder|example/i;

// Generated output and lockfiles are not hand-edited and carry no secrets.
const SKIP = [/\.map$/, /(^|\/)pnpm-lock\.yaml$/, /package-lock\.json$/, /\.(png|jpe?g|gif|webp|ico|mp3|wav|ogg|mp4|woff2?|ttf|pdf|gguf|bin)$/i];
const MAX_BYTES = 2_000_000;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => !SKIP.some((re) => re.test(f)));

const hits = [];
for (const file of files) {
  let text;
  try {
    if (statSync(file).size > MAX_BYTES) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      const match = re.exec(line);
      if (match && !FAKE_BODY.test(match[0])) hits.push(`${file}:${i + 1}  ${name}`);
    }
  });
}

if (hits.length) {
  console.error("Possible secrets committed to the repository:\n");
  for (const h of hits) console.error(`  ${h}`);
  console.error(
    "\nRotate the credential with its provider, then replace the value with a placeholder.",
  );
  process.exit(1);
}
console.log(`No secrets found in ${files.length} tracked files.`);
