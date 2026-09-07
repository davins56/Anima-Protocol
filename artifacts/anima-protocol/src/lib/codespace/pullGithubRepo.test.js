import { describe, expect, it, vi } from "vitest";
import { pullGithubRepo } from "./pullGithubRepo.js";
import { buildStoreZip } from "./zipCodec.js";
import { DEFAULT_PULL_REPO } from "./importProject.js";

describe("pullGithubRepo", () => {
  it("unpacks a client-side zip when CORS allows it", async () => {
    const zip = buildStoreZip([
      { path: "Anima-Protocol-main/src/hi.js", content: "export const hi = 1" },
      { path: "Anima-Protocol-main/node_modules/x/index.js", content: "ignored" },
    ]);
    const fetchImpl = vi.fn(async () => new Response(zip, { status: 200 }));
    const pullViaApi = vi.fn();
    const result = await pullGithubRepo(DEFAULT_PULL_REPO, { fetchImpl, pullViaApi });
    expect(result.files.map((f) => f.path)).toEqual(["src/hi.js"]);
    expect(pullViaApi).not.toHaveBeenCalled();
  });

  it("falls back to the authenticated archive API when fetch is blocked", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const pullViaApi = vi.fn(async (spec) => {
      expect(spec).toEqual(DEFAULT_PULL_REPO);
      return { files: [{ path: "README.md", content: "# Anima Protocol" }], skipped: [], errors: [] };
    });
    const result = await pullGithubRepo({}, { fetchImpl, pullViaApi });
    expect(pullViaApi).toHaveBeenCalledTimes(1);
    expect(result.files).toEqual([{ path: "README.md", content: "# Anima Protocol" }]);
  });
});
