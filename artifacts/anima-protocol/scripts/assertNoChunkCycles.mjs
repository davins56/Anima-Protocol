#!/usr/bin/env node
/**
 * Fails the build when built JS chunks statically import each other in a
 * cycle. A cycle lets a chunk run its top-level code before a chunk it depends
 * on has initialised (e.g. `new THREE.Matrix4()` with three still undefined),
 * which only breaks for some entry orders — exactly the /cyberworld
 * "undefined is not a constructor (evaluating 'new a')" crash.
 *
 * Usage: node scripts/assertNoChunkCycles.mjs dist/public
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** chunk file -> statically imported chunk files (same dir, "./x.js"). */
export function staticImports(code) {
  const out = new Set();
  const re = /(?:^|[;}\s])import\s*(?:[\w$*{}\s,]+from\s*)?["']\.\/([\w.-]+\.js)["']|(?:^|[;}\s])export\s*[\w$*{}\s,]*from\s*["']\.\/([\w.-]+\.js)["']/g;
  for (const m of code.matchAll(re)) out.add(m[1] || m[2]);
  return [...out];
}

/** Returns the cycles (as arrays of chunk names) in a {chunk: imports[]} graph. */
export function findCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (n) => {
    state.set(n, 1);
    stack.push(n);
    for (const d of graph[n] || []) {
      if (!(d in graph)) continue;
      if (state.get(d) === 1) cycles.push(stack.slice(stack.indexOf(d)).concat(d));
      else if (!state.get(d)) visit(d);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of Object.keys(graph)) if (!state.get(n)) visit(n);
  return cycles;
}

function main() {
  const dir = path.join(process.argv[2] || "dist/public", "assets");
  const graph = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) graph[f] = staticImports(fs.readFileSync(path.join(dir, f), "utf8"));
  const cycles = findCycles(graph);
  if (cycles.length) {
    console.error(`[assert-no-chunk-cycles] ${cycles.length} static import cycle(s) between chunks:`);
    for (const c of cycles.slice(0, 10)) console.error("  " + c.join(" -> "));
    process.exit(1);
  }
  console.log(`[assert-no-chunk-cycles] ok — ${Object.keys(graph).length} chunks, no static import cycles`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
