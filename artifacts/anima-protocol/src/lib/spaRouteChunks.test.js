import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Profile / EchoKeys lazy route chunks", () => {
  it("lazy-loads EchoKeys and UserProfile from App.full.jsx", () => {
    const app = readFileSync(join(root, "App.full.jsx"), "utf8");
    expect(app).toContain('const EchoKeys = lazy(() => import("./pages/EchoKeys"))');
    expect(app).toContain('const UserProfile = lazy(() => import("./pages/UserProfile"))');
    expect(app).toContain('path="/echo-keys"');
    expect(app).toContain('path="/profile"');
  });

  it("keeps the EchoKeys page module on disk for Vite to emit", () => {
    const page = readFileSync(join(root, "pages/EchoKeys.jsx"), "utf8");
    expect(page).toMatch(/export default function EchoKeys/);
    expect(page).toContain('from "@/lib/echoKeys"');
  });

  it("builds the SPA into dist/public so wrangler assets ./dist receives EchoKeys JS", () => {
    const vite = readFileSync(join(root, "..", "vite.config.ts"), "utf8");
    expect(vite).toContain('outDir: path.resolve(import.meta.dirname, "dist/public")');
    expect(vite).toContain("navigateFallback: null");
  });
});
