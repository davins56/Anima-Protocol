import { describe, expect, it, vi } from "vitest";
import {
  archivePathIsHeavy,
  buildStoreZip,
  fetchGithubArchiveFiles,
  GITHUB_ARCHIVE_LIMITS,
  unpackZipToTextFiles,
  validateGithubArchiveRef,
} from "../src/lib/githubArchive";

describe("githubArchive", () => {
  it("keeps the GitHub archive zip ceiling at 50MB", () => {
    expect(GITHUB_ARCHIVE_LIMITS.maxZipBytes).toBe(50 * 1024 * 1024);
  });

  it("validates owner/repo/branch and rejects traversal", () => {
    expect(validateGithubArchiveRef({
      owner: "davins56",
      repo: "Anima-Protocol",
      branch: "main",
    })).toEqual({
      ok: true,
      ref: { owner: "davins56", repo: "Anima-Protocol", branch: "main" },
    });
    expect(validateGithubArchiveRef({ owner: "davins56", repo: "Anima-Protocol", branch: "../etc" }).ok).toBe(false);
    expect(validateGithubArchiveRef({ owner: "https://evil", repo: "x" }).ok).toBe(false);
  });

  it("skips heavy monorepo paths", () => {
    expect(archivePathIsHeavy("Anima-Protocol-main/node_modules/x/index.js")).toBe(true);
    expect(archivePathIsHeavy("Anima-Protocol-main/dist/bundle.js")).toBe(true);
    expect(archivePathIsHeavy("Anima-Protocol-main/src/pages/Codespace.jsx")).toBe(false);
  });

  it("unpacks a store zip, strips the wrap folder, and skips node_modules", () => {
    const zip = buildStoreZip([
      { path: "Anima-Protocol-main/src/app.js", content: "export const n = 1" },
      { path: "Anima-Protocol-main/node_modules/left-pad/index.js", content: "module.exports=1" },
      { path: "Anima-Protocol-main/README.md", content: "# Anima Protocol" },
    ]);
    const result = unpackZipToTextFiles(zip);
    expect(result.files.map((f) => f.path).sort()).toEqual(["README.md", "src/app.js"]);
    expect(result.files.find((f) => f.path === "src/app.js")?.content).toContain("export const n = 1");
  });

  it("fetches a GitHub archive via the injected fetch and unpacks it", async () => {
    const zip = buildStoreZip([
      { path: "Anima-Protocol-main/lib/ok.js", content: "ok" },
    ]);
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("codeload.github.com/davins56/Anima-Protocol");
      return new Response(zip, { status: 200, headers: { "content-type": "application/zip" } });
    });
    const result = await fetchGithubArchiveFiles(
      { owner: "davins56", repo: "Anima-Protocol", branch: "main" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.files).toEqual([{ path: "lib/ok.js", content: "ok" }]);
  });
});
