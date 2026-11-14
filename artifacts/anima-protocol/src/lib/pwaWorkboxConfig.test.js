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
    const globPatterns =
      viteConfig.match(/globPatterns:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    expect(globPatterns).toContain("**/*.{svg,png,");
    expect(globPatterns).not.toMatch(/html/);
    // Hashed ES modules / CSS must not be precached (Safari module-script
    // failure when the SW intercepts /assets/*.js).
    expect(globPatterns).not.toMatch(/\{js,css,/);
    expect(globPatterns).not.toMatch(/\*\.js/);
    expect(globPatterns).not.toMatch(/\*\.css/);
  });

  it("fetches hashed JS and CSS network-only so the SW cannot intercept modules", () => {
    expect(viteConfig).toContain('url.pathname.startsWith("/assets/")');
    expect(viteConfig).toContain("(?:m?js|css)");
    expect(viteConfig).toContain('handler: "NetworkOnly"');
  });

  it("denies SW navigation fallback for /api and /assets so dead hashes cannot loop", () => {
    expect(viteConfig).toMatch(/navigateFallbackDenylist: \[\s*\/\^\\\/api/);
    expect(viteConfig).toContain("/^\\/assets");
  });

  it("precaches only the static offline page and falls back to it for offline navigations", () => {
    expect(viteConfig).toMatch(/additionalManifestEntries:\s*\[\s*\{ url: "\/offline\.html"/);
    expect(viteConfig).toContain('precacheFallback: { fallbackURL: "/offline.html" }');
    expect(viteConfig).toContain('handler: "NetworkOnly"');
  });

  it("waits for the Reload prompt instead of skipping waiting", () => {
    expect(viteConfig).toContain('registerType: "prompt"');
    expect(viteConfig).toContain("skipWaiting: false");
  });
});
