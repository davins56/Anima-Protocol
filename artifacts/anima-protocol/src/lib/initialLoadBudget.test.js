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
    expect(readSrc("ProtocolApp.jsx")).not.toMatch(staticSeedImport);
    expect(readSrc("lib/AuthContext.jsx")).not.toMatch(staticSeedImport);
    expect(readSrc("lib/syncBootstrap.js")).not.toMatch(staticSeedImport);
    expect(readSrc("lib/syncBootstrap.js")).toMatch(
      /import\(\s*["']@\/lib\/seedCharacters["']\s*\)/,
    );
    expect(readSrc("lib/AuthContext.jsx")).toMatch(
      /import\(\s*["']@\/lib\/seedCharacters["']\s*\)/,
    );
  });

  it("keeps Clerk and the route map out of the HTML entry module", () => {
    const entry = readSrc("App.full.jsx");
    expect(entry).not.toMatch(/from\s+["']@clerk\/react["']/);
    expect(entry).not.toMatch(/from\s+["']@clerk\/themes["']/);
    expect(entry).not.toContain("ClerkProvider");
    expect(entry).not.toMatch(/lazy\(\(\) => import\("\.\/pages\//);
    expect(entry).toContain('lazy(() => import("./ProtocolApp"))');
    expect(entry).toMatch(/import Landing from ["']\.\/pages\/Landing["']/);

    const shell = readSrc("ProtocolApp.jsx");
    expect(shell).toMatch(/from\s+["']@clerk\/react["']/);
    expect(shell).toContain("ClerkProvider");
    expect(shell).toContain('const MainHome = lazy(() => import("./pages/MainHome"))');
    expect(shell).toContain('const Chat = lazy(() => import("./pages/Chat"))');
    expect(shell).toContain(
      'const CustomiseAnima = lazy(() => import("./pages/CustomiseAnima"))',
    );
    expect(shell).not.toMatch(/import MainHome from /);
    expect(shell).not.toMatch(/import CustomiseAnima from /);
  });

  it("uses one layout Suspense instead of per-route stacked loaders", () => {
    const shell = readSrc("ProtocolApp.jsx");
    expect(shell).toContain("<Suspense fallback={<PageLoader />}>");
    expect(shell).toContain("<Routes location={location}>");
    const perRoute = (
      shell.match(/<Route[\s\S]*?<Suspense fallback=\{<PageLoader \/>\}>/g) ||
      []
    ).length;
    expect(perRoute).toBe(0);
  });

  it("PageLoader is a spinner without stacked Loading copy", () => {
    const loader = readSrc("app/PageLoader.jsx");
    expect(loader).toMatch(/aria-label=["']Loading page["']/);
    expect(loader).not.toMatch(/Loading\.\.\./);
  });

  it("SignedInHome does not block first paint on Anima.list", () => {
    const shell = readSrc("ProtocolApp.jsx");
    expect(shell).toContain("function SignedInHome");
    expect(shell).not.toMatch(
      /function SignedInHome\(\)[\s\S]{0,800}if \(state === "checking"\) return <PageLoader/,
    );
  });

  it("prefetches home / chat / customise after first paint", () => {
    const prefetch = readSrc("lib/prefetchHotRoutes.js");
    expect(prefetch).toContain('import("../pages/MainHome")');
    expect(prefetch).toContain('import("../pages/Chat")');
    expect(prefetch).toContain('import("../pages/CustomiseAnima")');
    expect(readSrc("ProtocolApp.jsx")).toContain("prefetchHotRoutes()");
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
    const headers = readFileSync(
      join(srcRoot, "..", "public/_headers"),
      "utf8",
    );
    expect(fallback).toContain("HASHED_ASSET_CACHE_CONTROL");
    expect(fallback).toContain("public, max-age=31536000, immutable");
    expect(fallback).toContain("cdn-cache-control");
    expect(vercel).toContain('"/assets/(.*)"');
    expect(vercel).toContain("max-age=31536000, immutable");
    expect(headers).toContain("/assets/*");
    expect(headers).toContain("max-age=31536000, immutable");
  });
});
