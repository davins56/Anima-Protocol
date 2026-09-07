import { describe, expect, it, vi } from "vitest";
import { hydrateRepoWorkspace } from "./hydrateRepoWorkspace.js";

describe("hydrateRepoWorkspace", () => {
  it("uses the live host tree when REPO_ROOT is available", async () => {
    const result = await hydrateRepoWorkspace({
      probeRepoFilesystem: async () => ({ available: true }),
      listRepoFiles: async () => ({
        ok: true,
        files: [{ path: "src/app.js", isDirectory: false }],
      }),
      storedFiles: [{ path: ".sessions/old.json", content: "{}" }],
      activePath: "README.md",
    });
    expect(result.mode).toBe("live");
    expect(result.repoLive).toBe(true);
    expect(result.files.map((f) => f.path)).toEqual(["src/app.js", ".sessions/old.json"]);
    expect(result.activePath).toBe("src/app.js");
  });

  it("keeps a previously imported workspace when disk is missing", async () => {
    const result = await hydrateRepoWorkspace({
      probeRepoFilesystem: async () => ({ available: false }),
      storedFiles: [{ path: "README.md", content: "# hi" }],
      activePath: "README.md",
      pullGithubRepo: vi.fn(),
    });
    expect(result.mode).toBe("stored");
    expect(result.repoUnavailable).toBe(true);
    expect(result.files[0].path).toBe("README.md");
  });

  it("auto-pulls davins56/Anima-Protocol when the explorer would otherwise be empty", async () => {
    const pullGithubRepo = vi.fn(async (spec) => {
      expect(spec).toEqual({ owner: "davins56", repo: "Anima-Protocol", branch: "main" });
      return { files: [{ path: "README.md", content: "# anima" }], errors: [] };
    });
    const result = await hydrateRepoWorkspace({
      probeRepoFilesystem: async () => ({ available: false }),
      storedFiles: [],
      pullGithubRepo,
    });
    expect(result.mode).toBe("github");
    expect(result.files.some((f) => f.path === "README.md")).toBe(true);
    expect(result.activePath).toBe("README.md");
    expect(pullGithubRepo).toHaveBeenCalledOnce();
  });
});
