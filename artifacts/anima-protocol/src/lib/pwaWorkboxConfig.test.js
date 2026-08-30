import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../vite.config.ts"),
  "utf8",
);

describe("PWA Workbox config", () => {
  it("does not precache HTML or navigate-fallback to index.html", () => {
    expect(viteConfig).toContain("navigateFallback: null");
    expect(viteConfig).toContain("cleanupOutdatedCaches: true");
    expect(viteConfig).toContain("navigateFallbackDenylist");
    expect(viteConfig).toMatch(/\*\*\/\*\.\{js,css,/);
    expect(viteConfig).not.toMatch(/globPatterns:[\s\S]*html/);
  });

  it("denies SW navigation fallback for /api and /assets so dead hashes cannot loop", () => {
    expect(viteConfig).toMatch(/navigateFallbackDenylist: \[\s*\/\^\\\/api/);
    expect(viteConfig).toContain("/^\\/assets");
  });
});
