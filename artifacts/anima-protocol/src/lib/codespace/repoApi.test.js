import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiOrigin", () => ({
  apiUrl: (path) => `https://app.test/api${path}`,
}));

vi.mock("@/api/authBridge", () => ({
  authHeaders: async () => ({ "Content-Type": "application/json" }),
}));

import {
  probeRepoFilesystem,
  listRepoFiles,
  writeRepoFile,
  pullGithubArchiveApi,
} from "./repoApi.js";

describe("repoApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats 503 status as filesystem unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ available: false, code: "filesystem_unavailable" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    )));
    const status = await probeRepoFilesystem();
    expect(status.available).toBe(false);
    expect(status.code).toBe("filesystem_unavailable");
  });

  it("lists files when the live tree is available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ available: true, files: [{ path: "src/app.js", isDirectory: false }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    const listed = await listRepoFiles();
    expect(listed.ok).toBe(true);
    expect(listed.files[0].path).toBe("src/app.js");
  });

  it("does not claim a write succeeded on a failed response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Repository filesystem is not available on this host." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    )));
    const written = await writeRepoFile("src/app.js", "nope");
    expect(written.ok).toBe(false);
    expect(written.error).toMatch(/not available/i);
  });

  it("returns unpacked files from the github-archive proxy", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(String(url)).toContain("/repo-codespace/github-archive");
      expect(JSON.parse(init.body)).toEqual({
        owner: "davins56",
        repo: "Anima-Protocol",
        branch: "main",
      });
      return new Response(
        JSON.stringify({ files: [{ path: "README.md", content: "# hi" }], skipped: [], errors: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }));
    const pulled = await pullGithubArchiveApi({
      owner: "davins56",
      repo: "Anima-Protocol",
      branch: "main",
    });
    expect(pulled.files[0].path).toBe("README.md");
  });
});
