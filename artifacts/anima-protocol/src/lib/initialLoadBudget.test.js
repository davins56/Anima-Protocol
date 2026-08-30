import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(srcRoot, "..", "..", "..");

function readSrc(rel) {
  return readFileSync(join(srcRoot, rel), "utf8");
}

describe("initial module graph budget", () => {
  it("keeps seedCharacters off the eager App / Auth / bootstrap graph", () => {
    const staticSeedImport = /from\s+['"]@\/lib\/seedCharacters['"]/;
    expect(readSrc("App.full.jsx")).not.toMatch(staticSeedImport);
    expect(readSrc("lib/AuthContext.jsx")).not.toMatch(staticSeedImport);
    expect(readSrc("lib/syncBootstrap.js")).not.toMatch(staticSeedImport);
    expect(readSrc("lib/syncBootstrap.js")).toContain(
      'import("@/lib/seedCharacters")',
    );
    expect(readSrc("lib/AuthContext.jsx")).toContain(
      'import("@/lib/seedCharacters")',
    );
  });

  it("eager-loads only Landing; home / chat / customise stay lazy", () => {
    const app = readSrc("App.full.jsx");
    expect(app).toMatch(/import Landing from ["']\.\/pages\/Landing["']/);
    expect(app).toContain('const MainHome = lazy(() => import("./pages/MainHome"))');
    expect(app).toContain('const Chat = lazy(() => import("./pages/Chat"))');
    expect(app).toContain(
      'const CustomiseAnima = lazy(() => import("./pages/CustomiseAnima"))',
    );
    expect(app).not.toMatch(/import MainHome from /);
    expect(app).not.toMatch(/import CustomiseAnima from /);
  });

  it("uses one layout Suspense instead of per-route stacked loaders", () => {
    const app = readSrc("App.full.jsx");
    expect(app).toContain("<Suspense fallback={<PageLoader />}>");
    expect(app).toContain("<Routes location={location}>");
    const perRoute = (
      app.match(/<Route[\s\S]*?<Suspense fallback=\{<PageLoader \/>\}>/g) || []
    ).length;
    expect(perRoute).toBe(0);
  });

  it("PageLoader is a spinner without stacked Loading copy", () => {
    const app = readSrc("App.full.jsx");
    expect(app).toMatch(/aria-label=["']Loading page["']/);
    expect(app).not.toMatch(
      /PageLoader[\s\S]{0,400}Loading\.\.\./,
    );
  });

  it("SignedInHome does not block first paint on Anima.list", () => {
    const app = readSrc("App.full.jsx");
    expect(app).toContain("function SignedInHome");
    expect(app).not.toMatch(
      /function SignedInHome\(\)[\s\S]{0,800}if \(state === "checking"\) return <PageLoader/,
    );
  });

  it("prefetches home / chat / customise after first paint", () => {
    const prefetch = readSrc("lib/prefetchHotRoutes.js");
    expect(prefetch).toContain('import("../pages/MainHome")');
    expect(prefetch).toContain('import("../pages/Chat")');
    expect(prefetch).toContain('import("../pages/CustomiseAnima")');
    expect(readSrc("App.full.jsx")).toContain("prefetchHotRoutes()");
  });

  it("does not block first paint on Algolia CDN CSS", () => {
    const html = readFileSync(join(srcRoot, "..", "index.html"), "utf8");
    expect(html).not.toMatch(
      /rel=["']stylesheet["'][^>]+algoliasearchNetlify\.css/,
    );
    expect(html).not.toMatch(
      /src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/@algolia\/algoliasearch-netlify-frontend/,
    );
  });
});

describe("hashed asset cache budget", () => {
  it("documents immutable Cache-Control for /assets on Cloudflare and Vercel", () => {
    const fallback = readFileSync(
      join(repoRoot, "artifacts/api-server/src/lib/spaAssetFallback.ts"),
      "utf8",
    );
    const vercel = readFileSync(join(repoRoot, "vercel.json"), "utf8");
    expect(fallback).toContain("HASHED_ASSET_CACHE_CONTROL");
    expect(fallback).toContain("public, max-age=31536000, immutable");
    expect(vercel).toContain('"/assets/(.*)"');
    expect(vercel).toContain("max-age=31536000, immutable");
  });
});
