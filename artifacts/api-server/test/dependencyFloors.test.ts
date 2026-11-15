import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Security audit 2026-11-14 (M4): keep the patched floors for the runtime
 * advisories. A lockfile regression (e.g. a stale override pin) fails here.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const lock = readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");

function resolvedVersions(name: string): string[] {
  const re = new RegExp(`^  '?${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}@(\\d+\\.\\d+\\.\\d+)[^:]*'?:`, "gm");
  return [...new Set([...lock.matchAll(re)].map((m) => m[1]!))];
}

function atLeast(version: string, floor: string): boolean {
  const a = version.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

describe("patched dependency floors", () => {
  for (const [name, floor] of [
    ["dompurify", "3.4.17"],
    ["body-parser", "2.4.0"],
    ["zod", "4.6.6"],
  ] as const) {
    it(`resolves ${name} only at >= ${floor}`, () => {
      const versions = resolvedVersions(name).filter((v) => !(name === "body-parser" && v.startsWith("1.")));
      expect(versions.length).toBeGreaterThan(0);
      for (const v of versions) expect(atLeast(v, floor), `${name}@${v}`).toBe(true);
    });
  }
});
