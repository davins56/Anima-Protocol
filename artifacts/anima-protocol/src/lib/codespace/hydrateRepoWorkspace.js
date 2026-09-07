// Decide how Repo Codespace fills the VS Code-like tree.
// Cloudflare Workers have no REPO_ROOT disk — fall through to a GitHub
// snapshot so the explorer is not an empty "Upload / Import / Pull" pane.

import { DEFAULT_PULL_REPO, mergeImportedFiles } from "./importProject";
import { isSessionPath, sessionFiles, workspaceFiles } from "./projectModel";

export async function hydrateRepoWorkspace({
  probeRepoFilesystem,
  listRepoFiles,
  pullGithubRepo,
  storedFiles = [],
  activePath = "",
  defaultPull = DEFAULT_PULL_REPO,
} = {}) {
  const sessions = sessionFiles(storedFiles);

  if (typeof probeRepoFilesystem === "function") {
    const status = await probeRepoFilesystem();
    if (status?.available && typeof listRepoFiles === "function") {
      const listed = await listRepoFiles();
      if (listed?.ok) {
        const mapped = (listed.files || [])
          .filter((f) => f && !f.isDirectory && f.path)
          .map((f) => ({ path: f.path, content: "", loaded: false }));
        const firstWs = mapped[0];
        const keepActive = Boolean(activePath)
          && mapped.some((f) => f.path === activePath);
        return {
          mode: "live",
          files: [...mapped, ...sessions],
          activePath: keepActive ? activePath : (firstWs ? firstWs.path : ""),
          repoLive: true,
          repoUnavailable: false,
        };
      }
    }
  }

  const existing = workspaceFiles(storedFiles);
  if (existing.length) {
    const firstWs = existing[0];
    return {
      mode: "stored",
      files: storedFiles,
      activePath: activePath || (firstWs ? firstWs.path : ""),
      repoLive: false,
      repoUnavailable: true,
    };
  }

  if (typeof pullGithubRepo !== "function") {
    return {
      mode: "empty",
      files: storedFiles,
      activePath: activePath || "",
      repoLive: false,
      repoUnavailable: true,
      pullErrors: ["GitHub pull is not available."],
    };
  }

  const pulled = await pullGithubRepo(defaultPull);
  if (pulled?.files?.length) {
    const merged = mergeImportedFiles(sessions, pulled.files, { replaceWorkspace: true });
    const first = pulled.files.find((f) => f?.path && !isSessionPath(f.path));
    return {
      mode: "github",
      files: merged,
      activePath: first?.path || "",
      repoLive: false,
      repoUnavailable: true,
      pullErrors: pulled.errors || [],
    };
  }

  return {
    mode: "empty",
    files: storedFiles,
    activePath: activePath || "",
    repoLive: false,
    repoUnavailable: true,
    pullErrors: pulled?.errors?.length
      ? pulled.errors
      : ["Could not load Anima Protocol from GitHub."],
  };
}
