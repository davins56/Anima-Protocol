// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Security audit 2026-11-14 (L3): admin / steward identity is decided by the
 * server (GET /api/account/role). No email allowlist or VITE_ADMIN_EMAILS may
 * ship in the client bundle again.
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("client bundle admin allowlist", () => {
  const files = sourceFiles(SRC);

  it("never reads VITE_ADMIN_EMAILS", () => {
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("VITE_ADMIN_EMAILS"));
    expect(hits).toEqual([]);
  });

  it("does not hardcode the steward's personal email addresses", () => {
    const hits = files.filter((f) => /davins56@(gmail|hotmail)\.com/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
