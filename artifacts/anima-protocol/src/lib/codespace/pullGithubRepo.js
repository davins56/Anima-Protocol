// Pull a GitHub repo into the virtual Codespace tree.
// Tries a direct archive download first (tests / rare CORS-open hosts), then
// the authenticated /api/repo-codespace/github-archive proxy.

import {
  DEFAULT_PULL_REPO,
  PULL_LIMITS,
  githubDownloadZipUrl,
  githubCodeloadZipUrl,
  importFromZipBuffer,
  normalizePullSpec,
} from "./importProject";
import { pullGithubArchiveApi } from "./repoApi";

export { DEFAULT_PULL_REPO, PULL_LIMITS };

export async function pullGithubRepo(input = DEFAULT_PULL_REPO, {
  fetchImpl = fetch,
  pullViaApi = pullGithubArchiveApi,
} = {}) {
  const spec = normalizePullSpec({ ...DEFAULT_PULL_REPO, ...input })
    || normalizePullSpec(DEFAULT_PULL_REPO);
  if (!spec) {
    return { files: [], skipped: [], errors: ["Need a GitHub owner/repo to pull."] };
  }

  const urls = [
    githubCodeloadZipUrl(spec.owner, spec.repo, spec.branch),
    githubDownloadZipUrl(spec.owner, spec.repo, spec.branch),
  ];

  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { redirect: "follow" });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength < 22) continue;
      const view = new Uint8Array(buf);
      if (view[0] !== 0x50 || view[1] !== 0x4b) continue; // PK
      return importFromZipBuffer(buf, { limits: PULL_LIMITS });
    } catch {
      // CORS or network — fall through to the API proxy.
    }
  }

  try {
    return await pullViaApi(spec);
  } catch (err) {
    return {
      files: [],
      skipped: [],
      errors: [err?.message || "Could not pull the GitHub archive."],
    };
  }
}
