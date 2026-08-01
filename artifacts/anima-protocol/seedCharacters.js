#!/usr/bin/env node
/**
 * Character seed entrypoint (CLI).
 *
 * IMPORTANT — the live Character Library does NOT read this file at runtime.
 *
 * Runtime path (what the app actually uses):
 *   src/lib/seedCharacters.js  →  getStarterRoster()
 *   → upserted via /api/store/Character  →  Postgres (DATABASE_URL)
 *
 * This package-root script used to push rows into a Supabase `characters`
 * table. That path is dead: the UI never queries Supabase for the roster.
 * Edit starter personalities / series in `src/lib/seedCharacters.js` instead.
 *
 * Usage:
 *   pnpm --filter @workspace/anima-protocol run seed:characters
 *
 * Ops check when the UI shows "Database unavailable":
 *   curl -sS https://www.anima-protocol.com/api/healthz/db
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_SEED = path.join(__dirname, "src/lib/seedCharacters.js");

function extractNames(src) {
  const names = [];
  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf("name:", i);
    if (idx === -1) break;
    const start = src.lastIndexOf("{", idx);
    if (start === -1) {
      i = idx + 5;
      continue;
    }
    let depth = 0;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (let j = start; j < src.length; j++) {
      const c = src[j];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === "\\") {
          esc = true;
          continue;
        }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      i = idx + 5;
      continue;
    }
    const block = src.slice(start, end + 1);
    i = end + 1;
    if (!/universe:\s*"/.test(block) || !/personality:\s*"/.test(block)) {
      continue;
    }
    const m = block.match(/name:\s*"([^"]+)"/);
    const u = block.match(/universe:\s*"([^"]+)"/);
    if (m && u) names.push({ name: m[1], universe: u[1] });
  }
  const seen = new Set();
  return names.filter((c) => {
    const key = `${c.name}|${c.universe}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function main() {
  console.log("--- Anima character seed (source-of-truth check) ---");
  console.log("Live roster file:", LIVE_SEED);

  if (!fs.existsSync(LIVE_SEED)) {
    console.error("Missing src/lib/seedCharacters.js — cannot validate roster.");
    process.exit(1);
  }

  const src = fs.readFileSync(LIVE_SEED, "utf8");
  const roster = extractNames(src);
  console.log(`Bundled starter characters: ${roster.length}`);
  const byUniverse = new Map();
  for (const c of roster) {
    byUniverse.set(c.universe, (byUniverse.get(c.universe) || 0) + 1);
  }
  for (const [universe, count] of byUniverse) {
    console.log(`  - ${universe}: ${count}`);
  }

  console.log(`
The app seeds these into each new account via /api/store (Postgres).
It does NOT read package-root seedCharacters.js or Supabase.

If Characters shows "Database unavailable" / 0 entities:
  1. curl -sS https://www.anima-protocol.com/api/healthz/db
  2. Fix Vercel Production DATABASE_URL so the host resolves
  3. Redeploy, sign in, open Characters (or Settings → repair starters)

Edit the roster in: src/lib/seedCharacters.js
`);
}

main();
